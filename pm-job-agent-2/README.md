# PM Job Agent

Polls Google Jobs (through [SerpApi](https://serpapi.com/google-jobs-api)) for
**Product Manager** listings posted in the last 24 hours, stores them in a local
SQLite database, and prints only the ones it hasn't seen before. Run it on a
schedule and each run shows you what's new.

By default it keeps results from every job board. `--source LinkedIn` narrows to
one board, at the cost of discarding most of what you fetched — see
[the filtering notes](#two-things-worth-knowing-about-the-filtering).

## Files

| File | Purpose |
|---|---|
| `job_agent.py` | Fetch, filter, store, report — the entry point |
| `db.py` | SQLite schema and the de-duplicating insert |
| `requirements.txt` | `requests`, `python-dotenv` |
| `.env.example` | Template for your API key |
| `jobs.db` | Created on first run (gitignored) |

## Setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

<details>
<summary>If <code>python3 -m venv</code> fails with "ensurepip is not available"</summary>

Some Debian/Ubuntu Python builds ship without `ensurepip`. Either
`sudo apt install python3-venv`, or bootstrap pip yourself:

```bash
python3 -m venv --without-pip venv
curl -sS -o get-pip.py https://bootstrap.pypa.io/get-pip.py
./venv/bin/python get-pip.py
./venv/bin/pip install -r requirements.txt
```
</details>

Then add your API key:

```bash
cp .env.example .env
# edit .env and set SERPAPI_KEY=your_key_here
```

Get a key at [serpapi.com/manage-api-key](https://serpapi.com/manage-api-key).
`.env` is gitignored — don't commit it. A real environment variable takes
precedence over `.env`, so `SERPAPI_KEY=… python job_agent.py` works too.

## Usage

```bash
python job_agent.py
```

```
Fetched 7 result(s) for 'Product Manager'; 3 matched LinkedIn within 24h.
Skipped: 1 from other boards, 2 older than 24h, 1 with no readable posting date.

3 new job(s):

--------------------------------------------------------------------
Senior Product Manager
  Monzo · London, UK
  5 hours ago (approx. 2026-08-02T07:52:26Z) · via LinkedIn
  job_id: id-001
--------------------------------------------------------------------
0 already in jobs.db; 3 stored in total.
```

### Options

| Flag | Default | Meaning |
|---|---|---|
| `--query` | `Product Manager` | Search terms |
| `--location` | *(none)* | e.g. `"United Kingdom"` |
| `--source` | *(all boards)* | Restrict to one board, e.g. `--source LinkedIn` |
| `--hours` | `24` | Freshness window |
| `--max-pages` | `3` | Pages to fetch (10 results per page) |
| `--db` | `jobs.db` | SQLite file path |

**Each page is one billable SerpApi search**, so the default run costs up to 3
against your plan's quota. Check your allowance before scheduling it hourly.

To run it every morning at 08:00:

```
0 8 * * * cd /path/to/pm-job-agent-2 && ./venv/bin/python job_agent.py >> agent.log 2>&1
```

## What gets stored

`jobs.db`, one table:

| Column | Notes |
|---|---|
| `job_id` | SerpApi's ID — **primary key**, this is what de-duplicates |
| `title` | |
| `company` | from `company_name` |
| `location` | |
| `posted_date` | ISO-8601 UTC, **approximate** — see below |
| `seen_at` | ISO-8601 UTC, when this run first recorded the job |

Inserts use `INSERT OR IGNORE`, so re-running is safe and never updates an
existing row. Only genuinely new rows are printed.

## Two things worth knowing about the filtering

Neither the job board nor "last 24 hours" can be enforced by the API alone, so
both are applied to the results locally. That's a deliberate choice, not an
oversight:

**Job board (off by default).** Google Jobs does not support the `site:`
operator — SerpApi documents it for Google *Search* only — and there is no
server-side "job board" parameter. So `--source` is matched against each
result's `via` field (in practice `"LinkedIn"`, though older docs show
`"via LinkedIn"`; the match is a case-insensitive substring, so both work)
*after* fetching. You pay for every result you then discard: in a live run,
`--source LinkedIn` threw away 7 of 10. That is why the default is now every
board. Narrowing is still available, it just isn't free.

**Last 24 hours.** The request sends `chips=date_posted:today` as a best-effort
narrowing, but Google has deprecated `chips` in favour of a dynamic `uds` string
that has to be read out of a prior response, and "today" isn't the same as "the
last 24 hours" anyway. So the real cut-off is applied to each result's
`detected_extensions.posted_at`. If SerpApi ever rejects `chips`, the script
warns, retries without it, and the local filter still holds the window. Google
returns relative strings (`"5 hours ago"`), so:

- `"1 day ago"` sits exactly on the boundary and is **kept** — Google rounds,
  and excluding it would drop genuinely fresh postings.
- `posted_date` is derived by subtracting that relative string from the current
  time. It's an estimate, good to roughly an hour. The absolute value is stored
  rather than the raw text because `"5 hours ago"` stops meaning anything once
  it's written to a database.
- Listings with no readable `posted_at` are **skipped**, since the 24-hour
  window can't be verified. The count is reported so it's visible.

## Limitations

- Google Jobs aggregates listings; the same role can appear under two different
  `job_id`s if it's posted to multiple boards, and de-duplication is by ID only.
- No retry/backoff on rate limits — a 429 surfaces as a `SerpApi error` and a
  non-zero exit.
- Exit codes: `0` success, `1` missing `SERPAPI_KEY`, `2` SerpApi/network error.
