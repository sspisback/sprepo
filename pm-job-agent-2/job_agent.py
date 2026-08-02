#!/usr/bin/env python3
"""Fetch recent Product Manager jobs from Google Jobs (via SerpApi), store new
ones in SQLite, and print whatever was new this run.

Filtering notes:

* **Job board** — off by default (every board is kept). Google Jobs does not
  support the `site:` operator (SerpApi documents it for Google Search only)
  and has no board parameter, so `--source LinkedIn` can only be applied to
  each result's `via` field after fetching — you pay for results you discard.
* **Last 24 hours** — the API's date filter is coarse ("today") and the `chips`
  parameter carrying it is deprecated by Google. It is still sent as a
  best-effort narrowing, but the real cut-off is applied to each result's
  `detected_extensions.posted_at`.

That way the output stays correct even if Google changes the filter plumbing.
"""

import argparse
import os
import re
import sys
from datetime import datetime, timedelta, timezone

import requests
from dotenv import load_dotenv

import db

SERPAPI_ENDPOINT = "https://serpapi.com/search"

DEFAULT_QUERY = "Product Manager"
# Empty means every job board. Filtering to one board (e.g. --source LinkedIn)
# discards ~70% of results that you have already paid to fetch, because the
# board cannot be constrained server-side — see from_source().
DEFAULT_SOURCE = ""
DEFAULT_WINDOW_HOURS = 24

# Deprecated by Google in favour of a dynamic `uds` string, but still accepted
# and still the only *static* way to ask for recent postings. Best-effort only:
# the authoritative cut-off is applied client-side in within_window().
DATE_CHIP = "date_posted:today"

REQUEST_TIMEOUT = 30
MAX_PAGES_DEFAULT = 3

_RELATIVE = re.compile(r"(\d+)\s*\+?\s*(minute|hour|day|week|month)s?\s+ago", re.I)
_UNIT_HOURS = {"minute": 1 / 60, "hour": 1.0, "day": 24.0, "week": 168.0, "month": 720.0}


class SerpApiError(RuntimeError):
    """SerpApi returned an error payload or an unusable response."""


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------


def fetch_page(api_key, query, location=None, next_page_token=None, use_chips=True):
    """Fetch one page of Google Jobs results. Returns the parsed JSON body."""
    params = {
        "engine": "google_jobs",
        "q": query,
        "api_key": api_key,
        "hl": "en",
    }
    if location:
        params["location"] = location
    if use_chips:
        params["chips"] = DATE_CHIP
    if next_page_token:
        params["next_page_token"] = next_page_token

    try:
        resp = requests.get(SERPAPI_ENDPOINT, params=params, timeout=REQUEST_TIMEOUT)
    except requests.RequestException as exc:
        raise SerpApiError(f"request to SerpApi failed: {exc}") from exc

    try:
        payload = resp.json()
    except ValueError as exc:
        raise SerpApiError(
            f"SerpApi returned non-JSON (HTTP {resp.status_code})"
        ) from exc

    # SerpApi reports problems in the body, often still with HTTP 200.
    if isinstance(payload, dict) and payload.get("error"):
        raise SerpApiError(payload["error"])
    if resp.status_code != 200:
        raise SerpApiError(f"HTTP {resp.status_code} from SerpApi")

    return payload


def fetch_jobs(api_key, query, location=None, max_pages=MAX_PAGES_DEFAULT):
    """Yield raw job dicts across up to max_pages pages of results."""
    token = None
    use_chips = True

    for page in range(1, max_pages + 1):
        try:
            payload = fetch_page(api_key, query, location, token, use_chips)
        except SerpApiError as exc:
            message = str(exc).lower()
            # `chips` is deprecated; if it is what broke the call, drop it and
            # retry once. The client-side window filter still holds the line.
            if use_chips and "chip" in message:
                print(
                    f"note: SerpApi rejected the date filter ({exc}); "
                    "retrying without it and filtering locally.",
                    file=sys.stderr,
                )
                use_chips = False
                payload = fetch_page(api_key, query, location, token, use_chips)
            elif "returned any results" in message:
                # SerpApi reports an exhausted result set as an error. Past the
                # first page that is just the end of pagination; on the first it
                # means the query genuinely matched nothing. Neither is a
                # failure — and raising here would throw away earlier pages.
                if page > 1:
                    print(
                        f"note: no further results after page {page - 1}.",
                        file=sys.stderr,
                    )
                return
            else:
                raise

        results = payload.get("jobs_results") or []
        yield from results

        token = (payload.get("serpapi_pagination") or {}).get("next_page_token")
        if not token or not results:
            break


# --------------------------------------------------------------------------
# Filtering / normalising
# --------------------------------------------------------------------------


def hours_since_posted(posted_at):
    """Approximate hours since posting from Google's relative string.

    Returns None when the string is missing or unrecognised, so callers can
    tell "definitely old" apart from "unknown".
    """
    if not posted_at:
        return None
    text = posted_at.strip().lower()
    if text in {"just posted", "just now", "today", "new"}:
        return 0.0
    match = _RELATIVE.search(text)
    if not match:
        return None
    return int(match.group(1)) * _UNIT_HOURS[match.group(2).lower()]


def within_window(job, window_hours=DEFAULT_WINDOW_HOURS):
    """True if the job was posted inside the window.

    Google rounds, so "1 day ago" lands exactly on a 24h boundary and is kept —
    excluding it would drop genuinely fresh postings.
    """
    hours = hours_since_posted((job.get("detected_extensions") or {}).get("posted_at"))
    return hours is not None and hours <= window_hours


def from_source(job, source=DEFAULT_SOURCE):
    """True if the listing came via the given board (matched on the `via` field)."""
    if not source:
        return True
    return source.lower() in (job.get("via") or "").lower()


def normalise(job, now=None):
    """Flatten a SerpApi result into the row shape stored in SQLite."""
    now = now or datetime.now(timezone.utc)
    detected = job.get("detected_extensions") or {}
    posted_at = detected.get("posted_at")
    hours = hours_since_posted(posted_at)

    # posted_date is stored absolute: "5 hours ago" stops being meaningful the
    # moment it is written down. Derived from Google's relative string, so it
    # is approximate — minute precision is already more than it deserves.
    if hours is None:
        posted_date = None
    else:
        posted_date = (now - timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")

    return {
        "job_id": job.get("job_id"),
        "title": job.get("title") or "(untitled)",
        "company": job.get("company_name"),
        "location": job.get("location"),
        "posted_date": posted_date,
        "seen_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        # not persisted, used for the console output only
        "_posted_at": posted_at,
        "_via": job.get("via"),
    }


# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------


def print_jobs(jobs):
    rule = "-" * 68
    print(rule)
    for job in jobs:
        print(f"{job['title']}")
        company = job["company"] or "Unknown company"
        location = job["location"] or "Location not stated"
        print(f"  {company} · {location}")

        when = job.get("_posted_at") or "posting date unknown"
        if job["posted_date"]:
            when = f"{when} (approx. {job['posted_date']})"
        via = job.get("_via") or "source unknown"
        print(f"  {when} · {via}")

        # Google's job_id is a ~500-char base64 blob. Print enough to identify
        # the row by eye; the full value is in the database.
        jid = job["job_id"] or ""
        print(f"  job_id: {jid[:24]}…" if len(jid) > 25 else f"  job_id: {jid}")
        print(rule)


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Fetch recent Product Manager jobs from Google Jobs via SerpApi."
    )
    parser.add_argument("--query", default=DEFAULT_QUERY, help="search query")
    parser.add_argument(
        "--location", default=None, help='e.g. "United Kingdom" (omit for Google default)'
    )
    parser.add_argument(
        "--source",
        default=DEFAULT_SOURCE,
        help='job board to keep, matched against `via` (use "" for all boards)',
    )
    parser.add_argument(
        "--hours", type=int, default=DEFAULT_WINDOW_HOURS, help="freshness window"
    )
    parser.add_argument(
        "--max-pages", type=int, default=MAX_PAGES_DEFAULT, help="pages to fetch"
    )
    parser.add_argument("--db", default=db.DEFAULT_DB_PATH, help="SQLite file path")
    return parser.parse_args(argv)


def run(args, api_key):
    raw = list(fetch_jobs(api_key, args.query, args.location, args.max_pages))

    kept, wrong_source, too_old, undated = [], 0, 0, 0
    for job in raw:
        if not from_source(job, args.source):
            wrong_source += 1
            continue
        posted_at = (job.get("detected_extensions") or {}).get("posted_at")
        if hours_since_posted(posted_at) is None:
            undated += 1
            continue
        if not within_window(job, args.hours):
            too_old += 1
            continue
        kept.append(normalise(job))

    # Drop anything without a job_id — it cannot be deduplicated.
    kept = [j for j in kept if j["job_id"]]

    conn = db.connect(args.db)
    try:
        new_jobs = db.insert_new_jobs(conn, kept)
        total = db.count_jobs(conn)
    finally:
        conn.close()

    source_label = args.source or "all sources"
    print(
        f"Fetched {len(raw)} result(s) for {args.query!r}; "
        f"{len(kept)} matched {source_label} within {args.hours}h."
    )
    skipped = []
    if wrong_source:
        skipped.append(f"{wrong_source} from other boards")
    if too_old:
        skipped.append(f"{too_old} older than {args.hours}h")
    if undated:
        skipped.append(f"{undated} with no readable posting date")
    if skipped:
        print("Skipped: " + ", ".join(skipped) + ".")

    if new_jobs:
        print(f"\n{len(new_jobs)} new job(s):\n")
        print_jobs(new_jobs)
    else:
        print("\nNo new jobs since the last run.")

    print(f"{len(kept) - len(new_jobs)} already in {args.db}; {total} stored in total.")
    return 0


def main(argv=None):
    # Parse first, so --help works without a key configured.
    args = parse_args(argv)

    load_dotenv()
    api_key = os.environ.get("SERPAPI_KEY")
    if not api_key:
        print(
            "SERPAPI_KEY is not set. Copy .env.example to .env and add your key "
            "(get one at https://serpapi.com/manage-api-key).",
            file=sys.stderr,
        )
        return 1

    try:
        return run(args, api_key)
    except SerpApiError as exc:
        print(f"SerpApi error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
