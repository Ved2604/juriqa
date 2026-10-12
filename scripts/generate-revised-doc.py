"""Generate a revised version of the test MSA with known, varied changes for comparison testing.

Changes vs msa-v1 (see generate-test-docs.py):
  4.3  notice period 90 -> 60 days (substantive)
  5.1  reworded, same meaning (cosmetic)
  9.2  liability cap AED 100,000 -> AED 1,000,000, and made mutual (substantive)
  13.4 removed
  14.9 added: notices may be given by email
  16.1 governing law clause given real content (substantive)
"""
import random, sys
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

random.seed(7)  # same seed as v1 so untouched clauses are identical
OUT = sys.argv[1]
TOPICS = ["DEFINITIONS","SCOPE OF SERVICES","FEES AND PAYMENT","TERM AND TERMINATION","CONFIDENTIALITY",
 "INTELLECTUAL PROPERTY","WARRANTIES","INDEMNIFICATION","LIMITATION OF LIABILITY","INSURANCE",
 "DATA PROTECTION","FORCE MAJEURE","ASSIGNMENT","NOTICES","DISPUTE RESOLUTION","GOVERNING LAW",
 "NON-SOLICITATION","AUDIT RIGHTS","SUBCONTRACTING","GENERAL PROVISIONS"]
FILL = ("the Supplier shall perform its obligations under this Agreement with reasonable skill, care and diligence "
 "in accordance with good industry practice, all applicable laws and the reasonable instructions of the Customer as notified in writing from time to time")

def clauses():
    out = []
    for n, t in enumerate(TOPICS, 1):
        subs = []
        for k in range(1, 9):
            body = f"Subject to clause {random.randint(1,20)}, {FILL}"
            if t == "LIMITATION OF LIABILITY" and k == 2:
                body = "Each Party's total aggregate liability arising out of or in connection with this Agreement shall not exceed AED 1,000,000 in any Contract Year, whether in contract, tort (including negligence) or otherwise."
            if t == "TERM AND TERMINATION" and k == 3:
                body = "Either Party may terminate this Agreement by giving the other Party not less than sixty (60) days' written notice. Upon termination, the Customer shall pay all undisputed fees accrued up to the date of termination, including fees for work in progress, and the Supplier shall promptly return all Customer Materials in its possession."
            if t == "CONFIDENTIALITY" and k == 1:
                body = body.replace("with reasonable skill, care and diligence", "with reasonable care, skill and diligence")
            if t == "GOVERNING LAW" and k == 1:
                body = "This Agreement shall be governed by the laws of the Dubai International Financial Centre, and the DIFC Courts shall have exclusive jurisdiction over any dispute."
            if k == 5:
                body = (body + ". ") * 4
            if t == "ASSIGNMENT" and k == 4:
                continue
            subs.append((f"{n}.{k}", body.rstrip(". ") + "."))
        if t == "NOTICES":
            subs.append((f"{n}.9", "Notices under this Agreement may also be given by email to the addresses notified by each Party, and are deemed received on the next Business Day."))
        out.append((n, t, subs))
    return out

ss = getSampleStyleSheet()
h = ParagraphStyle("h", parent=ss["Heading2"], fontSize=12)
p = ParagraphStyle("p", parent=ss["BodyText"], fontSize=10, leading=13, spaceAfter=6)
def deco(c, d):
    c.saveState(); c.setFont("Helvetica", 8)
    c.drawString(72, A4[1]-40, "MASTER SERVICES AGREEMENT - CONFIDENTIAL")
    c.drawCentredString(A4[0]/2, 30, f"Page {d.page}")
    c.restoreState()
story = [Paragraph("MASTER SERVICES AGREEMENT", ss["Title"]),
         Paragraph("This Agreement is made between Acme Trading LLC (the \"Customer\") and Beta Systems Ltd. (the \"Supplier\").", p)]
for n, t, subs in clauses():
    story.append(Paragraph(f"{n}. {t}", h))
    for num, body in subs:
        story.append(Paragraph(f"{num} {body}", p))
SimpleDocTemplate(f"{OUT}/msa-v3-revised.pdf", pagesize=A4).build(story, onFirstPage=deco, onLaterPages=deco)
print("generated msa-v3-revised.pdf")
