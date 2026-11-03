"""One-page text example for the Break-it skill, in the workflow house look."""
import os, sys
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

ASSETS = os.path.expanduser("~/.claude/skills/workflow-project/assets")
for w in ["Regular", "Medium", "SemiBold", "Bold", "ExtraBold"]:
    pdfmetrics.registerFont(TTFont(w, os.path.join(ASSETS, "fonts", f"PlusJakartaSans-{w}.ttf")))

INK, SOFT, FAINT = HexColor("#10182E"), HexColor("#4A5478"), HexColor("#8A93B2")
ACCENT, GOLD, RED, GREEN = HexColor("#3E5BFF"), HexColor("#C4962E"), HexColor("#E03131"), HexColor("#2F9E6E")
LINE, CHIP = HexColor("#D6DCEF"), HexColor("#EEF1FF")
PANEL, PANEL_INK, PANEL_SOFT = HexColor("#10182E"), HexColor("#E6EAF8"), HexColor("#8A93B2")

W, H = A4
M = 46
out = sys.argv[1]
c = canvas.Canvas(out, pagesize=A4)
c.setTitle("Break-it Skill - Example")

# header
c.drawImage(os.path.join(ASSETS, "logo-mark.png"), M, H - 58, 18, 18, mask="auto")
c.setFont("Bold", 10); c.setFillColor(INK); c.drawString(M + 26, H - 53, "WorkSpace")
c.setFillColor(ACCENT); c.drawString(M + 26 + pdfmetrics.stringWidth("WorkSpace ", "Bold", 10), H - 53, "Labs")
c.setStrokeColor(LINE); c.setFillColor(CHIP); c.roundRect(W - M - 70, H - 60, 70, 16, 8, fill=1)
c.setFillColor(ACCENT); c.setFont("Bold", 6.5); c.drawCentredString(W - M - 35, H - 55, "E X A M P L E")
c.setStrokeColor(LINE); c.line(M, H - 70, W - M, H - 70)

y = H - 96
c.setFont("Bold", 7); c.setFillColor(SOFT); c.drawString(M, y, "B R E A K - I T   S K I L L   ·   O N E   R E A L   R U N")
y -= 28
c.setFont("ExtraBold", 24); c.setFillColor(INK); c.drawString(M, y, "Can a customer see")
y -= 28
c.setFillColor(ACCENT); c.drawString(M, y, "someone else's order?")
y -= 20
c.setFont("Regular", 9.5); c.setFillColor(SOFT)
c.drawString(M, y, "A small shop web app is delivered. Before it is pushed, the reviewer runs break-it on it.")

def heading(num, text, yy):
    c.setFillColor(ACCENT); c.circle(M + 7, yy + 3.5, 7, fill=1, stroke=0)
    c.setFillColor(HexColor("#FFFFFF")); c.setFont("Bold", 8); c.drawCentredString(M + 7, yy + 0.8, str(num))
    c.setFillColor(INK); c.setFont("Bold", 12); c.drawString(M + 22, yy, text)

def panel(lines, yy, lead=12.2, pad=12):
    h = len(lines) * lead + pad * 2 - 3
    c.setFillColor(PANEL); c.roundRect(M, yy - h, W - 2 * M, h, 8, fill=1, stroke=0)
    ty = yy - pad - 7
    for parts in lines:
        x = M + pad
        for text, color, font in parts:
            c.setFillColor(color); c.setFont(font, 8.4); c.drawString(x, ty, text)
            x += pdfmetrics.stringWidth(text, font, 8.4)
        ty -= lead
    return yy - h

T = lambda s, col=PANEL_INK, f="Courier": (s, col, f)
B = lambda s, col=PANEL_INK: (s, col, "Courier-Bold")

# 1 You ask
y -= 34; heading(1, "You ask", y)
y = panel([[T("> ", ACCENT), T("Run break-it on shop-app")]], y - 10)

# 2 What it does
y -= 28; heading(2, "What break-it does, by itself", y)
steps = [
    ("Checks the target", "shop-app is your own project on this Mac, not a live site."),
    ("Makes a throwaway copy", "and seals the real project with a fingerprint of every file."),
    ("Attacks the copy", "48 attacks: bad input, other people's data, injection, password guessing."),
    ("Checks the seal, deletes the copy", "and writes the report below."),
]
y -= 8
for t, d in steps:
    y -= 15
    c.setFillColor(ACCENT); c.circle(M + 26, y + 3, 1.8, fill=1, stroke=0)
    c.setFillColor(INK); c.setFont("SemiBold", 9.2); c.drawString(M + 34, y, t)
    c.setFillColor(SOFT); c.setFont("Regular", 9.2); c.drawString(M + 38 + pdfmetrics.stringWidth(t, "SemiBold", 9.2), y, d)

# 3 Report
y -= 30; heading(3, "The report it gives you", y)
y = panel([
    [B("BREAK-IT REPORT"), T("  shop-app  ·  version 0.2", PANEL_SOFT)],
    [T("Seal: ", PANEL_SOFT), B("real project unchanged", GREEN)],
    [T("Attacks: 48 tried   46 blocked   ", PANEL_SOFT), B("2 got through", GOLD)],
    [T("")],
    [B("CRITICAL", RED), B("  Other people's orders are open")],
    [T("  Tried   ", PANEL_SOFT), T("Logged in as user A, opened /orders/6 (user B's order)")],
    [T("  Saw     ", PANEL_SOFT), T("B's name, home address and card ending 4421")],
    [T("  Where   ", PANEL_SOFT), T("src/routes/orders.js:42  ->  const order = db.find(id)")],
    [T("  Advice  ", PANEL_SOFT), T("Show an order only to the user who owns it")],
    [T("")],
    [B("SMALL", GOLD), B("     No limit on login tries")],
    [T("  Tried   ", PANEL_SOFT), T("500 wrong passwords in one minute")],
    [T("  Saw     ", PANEL_SOFT), T("All 500 answered, no slowdown, no lock")],
    [T("  Where   ", PANEL_SOFT), T("src/routes/login.js:18")],
    [T("  Advice  ", PANEL_SOFT), T("Lock the account for 15 minutes after 5 wrong tries")],
    [T("")],
    [T("Copy deleted. Nothing left behind. ", PANEL_SOFT), B("Break-it changed no code.", PANEL_INK)],
], y - 10)

# 4 After the fix
y -= 28; heading(4, "The builder fixes, break-it attacks again", y)
y = panel([
    [B("ROUND 2"), T("  shop-app", PANEL_SOFT)],
    [T("Seal: ", PANEL_SOFT), B("real project unchanged", GREEN)],
    [T("Attacks: 48 tried   ", PANEL_SOFT), B("48 blocked", GREEN), T("   0 got through", PANEL_SOFT)],
    [T("Critical holes: ", PANEL_SOFT), B("0", GREEN), T("   ->   ", PANEL_SOFT), B("Ready for the owner's look", GREEN)],
], y - 10)

# promise line
y -= 26
c.setStrokeColor(LINE); c.line(M, y + 12, W - M, y + 12)
c.setFont("Bold", 9); c.setFillColor(INK); c.drawString(M, y - 2, "Break-it never")
c.setFont("Regular", 9); c.setFillColor(SOFT)
c.drawString(M + pdfmetrics.stringWidth("Break-it never ", "Bold", 9), y - 2,
             "fixes code, never touches your real project and never attacks a live site.")

c.setFont("Regular", 7); c.setFillColor(FAINT)
c.drawString(M, 30, "Break-it Skill  ·  example  ·  version 0.1  ·  3 November 2026")
c.drawRightString(W - M, 30, "workspace-labs.net")
c.save()
print("wrote", out, "bottom y =", round(y))
