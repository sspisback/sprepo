import json
import os
from functools import wraps

from flask import (
    Flask,
    redirect,
    render_template,
    request,
    session,
    url_for,
)

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-me")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
USERS_FILE = os.path.join(BASE_DIR, "users.txt")
STUDENTS_FILE = os.path.join(BASE_DIR, "students.json")


def load_users():
    """Read users.txt into a {username: password} dict.

    Format is one "username:password" pair per line. Blank lines and lines
    starting with '#' are ignored.
    """
    users = {}
    try:
        with open(USERS_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or ":" not in line:
                    continue
                username, password = line.split(":", 1)
                users[username.strip()] = password.strip()
    except FileNotFoundError:
        pass
    return users


def load_students():
    """Read students.json into a {username: record} dict."""
    try:
        with open(STUDENTS_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def check_credentials(username, password):
    return load_users().get(username) == password


def summarise_attendance(attendance):
    """Turn raw absence day counts into the figures the dashboard displays."""
    school_days = attendance["school_days"]
    authorised = attendance["authorised_days"]
    unauthorised = attendance["unauthorised_days"]
    target = attendance["target_pct"]

    present = school_days - authorised - unauthorised
    pct = round(present / school_days * 100, 1) if school_days else 0.0

    # England's DfE bands: 95%+ is the school target, below 90% is
    # "persistent absence". Each band ships with a word, never colour alone.
    if pct >= target:
        band, band_label = "good", "At or above target"
    elif pct >= 90:
        band, band_label = "warning", "Below target"
    else:
        band, band_label = "critical", "Persistent absence"

    return {
        "school_days": school_days,
        "authorised_days": authorised,
        "unauthorised_days": unauthorised,
        "total_absence_days": authorised + unauthorised,
        "present_days": present,
        "pct": pct,
        "target_pct": target,
        "gap_to_target": round(pct - target, 1),
        "band": band,
        "band_label": band_label,
    }


def summarise_grades(grades):
    """Annotate each subject with its distance from the target grade."""
    rows = []
    for entry in grades:
        delta = entry["grade"] - entry["target"]
        if delta > 0:
            state, glyph, state_label = "above", "▲", "above target"
        elif delta == 0:
            state, glyph, state_label = "on", "●", "on target"
        else:
            state, glyph, state_label = "below", "▼", "below target"
        rows.append(
            {
                **entry,
                "delta": delta,
                "state": state,
                "glyph": glyph,
                "state_label": state_label,
            }
        )
    return rows


def build_profile(record):
    """Assemble the full view model the dashboard template renders."""
    grades = summarise_grades(record["grades"])
    return {
        "first_name": record["first_name"],
        "surname": record["surname"],
        "full_name": f"{record['first_name']} {record['surname']}",
        "year_group": record["year_group"],
        "form_class": record["form_class"],
        "class_teacher": record["class_teacher"],
        "term": record["term"],
        "attendance": summarise_attendance(record["attendance"]),
        "grades": grades,
        "grade_counts": {
            "above": sum(1 for g in grades if g["state"] == "above"),
            "on": sum(1 for g in grades if g["state"] == "on"),
            "below": sum(1 for g in grades if g["state"] == "below"),
        },
        "improvements": record["improvements"],
    }


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if "username" not in session:
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


@app.route("/")
def index():
    if "username" in session:
        return redirect(url_for("dashboard"))
    return redirect(url_for("login"))


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    if request.method == "POST":
        username = request.form.get("username", "")
        password = request.form.get("password", "")
        if check_credentials(username, password):
            session["username"] = username
            return redirect(url_for("dashboard"))
        error = "Invalid username or password."
    return render_template("login.html", error=error)


@app.route("/dashboard")
@login_required
def dashboard():
    username = session["username"]
    record = load_students().get(username)
    profile = build_profile(record) if record else None
    return render_template("dashboard.html", username=username, profile=profile)


@app.route("/logout")
def logout():
    session.pop("username", None)
    return redirect(url_for("login"))


if __name__ == "__main__":
    app.run(debug=True)
