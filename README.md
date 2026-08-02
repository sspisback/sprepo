# sprepo

Two small experimental projects.

## [`simple-web-app/`](simple-web-app/) — Flask student dashboard

A two-page Flask app: a login page and a student dashboard showing year group,
class, class teacher, attendance (authorised vs unauthorised absence), current
grades against target, and per-subject notes on where to improve. Sessions
gate the dashboard; logging out clears them.

```bash
cd simple-web-app
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
./venv/bin/python app.py      # http://127.0.0.1:5000
```

Demo logins are in `users.txt` (`admin` / `admin123`, `alice` / `wonderland`).
Passwords are stored in plaintext — it is a demo, not a pattern to copy.

## [`pm-job-agent-2/`](pm-job-agent-2/) — SerpApi job agent

Polls Google Jobs via SerpApi for Product Manager roles posted in the last 24
hours, stores them in SQLite, and prints only what it hasn't seen before.
Full setup and options in [its README](pm-job-agent-2/README.md).

```bash
cd pm-job-agent-2
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
cp .env.example .env          # add your SERPAPI_KEY
./venv/bin/python job_agent.py
```

## Note

Both projects need a virtual environment, which is not committed. On Debian or
Ubuntu builds where `python3 -m venv` fails with "ensurepip is not available",
see the bootstrap workaround in `pm-job-agent-2/README.md`.
