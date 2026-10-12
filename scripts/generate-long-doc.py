"""Generate a ~150-page contract with facts planted deep in the document, for large-document testing.

Planted facts (to check the app reads beyond the first pages):
  - Article 18.7: non-compete, 12 months, GCC region
  - Article 23.4: liability cap of AED 2,500,000
  - Article 29.3: governing law of England and Wales, LCIA arbitration in London
"""
import random, sys
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

random.seed(42)
OUT = sys.argv[1]
SUBJECTS = ["The Supplier", "The Customer", "Each Party", "The Service Provider", "The Contractor", "Neither Party"]
VERBS = ["shall ensure that", "shall procure that", "undertakes that", "acknowledges and agrees that", "shall use reasonable endeavours to ensure that", "warrants that"]
OBJECTS = [
    "all deliverables conform in all material respects to the Specification",
    "its personnel comply with the Customer's site rules and security policies",
    "records relating to the Services are maintained for not less than six years",
    "any change to the Services is agreed in writing through the Change Control Procedure",
    "key personnel are not replaced without prior written consent, not to be unreasonably withheld",
    "reports on service levels are delivered within ten Business Days of the end of each month",
    "all equipment provided is maintained in good working order, fair wear and tear excepted",
    "it holds all licences, permits and consents required to perform its obligations",
    "information security incidents are notified without undue delay",
    "subcontractors are bound by obligations no less onerous than those in this Agreement",
]
TAILS = [
    "", " This obligation survives termination of this Agreement.", " Any failure shall be remedied within thirty (30) days of notice.",
    " The Customer may audit compliance on reasonable notice.", " Time shall not be of the essence in respect of this obligation.",
]
ARTICLES = ["Definitions and Interpretation","Commencement and Term","The Services","Service Levels","Customer Obligations","Charges","Invoicing and Payment",
 "Taxes","Personnel","Subcontracting","Change Control","Governance","Reporting","Records and Audit","Intellectual Property","Licences",
 "Confidentiality","Restrictive Covenants","Data Protection","Information Security","Warranties","Indemnities","Limitation of Liability",
 "Insurance","Force Majeure","Termination","Consequences of Termination","Exit Management","Governing Law and Disputes","Notices","General"]
PLANTED = {
    ("Restrictive Covenants", 7): "The Supplier shall not, during the Term and for a period of twelve (12) months after its termination, directly or indirectly engage in or be concerned with any business that competes with the business of the Customer within the GCC region.",
    ("Limitation of Liability", 4): "Subject to clause 23.1, the total aggregate liability of each Party under or in connection with this Agreement shall not exceed AED 2,500,000 in any Contract Year.",
    ("Governing Law and Disputes", 3): "This Agreement shall be governed by the laws of England and Wales. Any dispute shall be finally resolved by arbitration under the LCIA Rules, seated in London.",
}

def sentence():
    return f"{random.choice(SUBJECTS)} {random.choice(VERBS)} {random.choice(OBJECTS)}.{random.choice(TAILS)}"

ss = getSampleStyleSheet()
h = ParagraphStyle("h", parent=ss["Heading2"], fontSize=12)
p = ParagraphStyle("p", parent=ss["BodyText"], fontSize=10, leading=13, spaceAfter=6)
def deco(c, d):
    c.saveState(); c.setFont("Helvetica", 8)
    c.drawString(72, 800, "OUTSOURCING SERVICES AGREEMENT")
    c.drawCentredString(297, 30, f"Page {d.page} of 150")
    c.restoreState()
story = [Paragraph("OUTSOURCING SERVICES AGREEMENT", ss["Title"]),
         Paragraph("This Agreement is made between Gulf Retail Holdings PJSC (the \"Customer\") and Northwind Technology Services Ltd (the \"Supplier\").", p)]
for n, title in enumerate(ARTICLES, 1):
    story.append(Paragraph(f"{n}. {title.upper()}", h))
    for k in range(1, 36):
        text = PLANTED.get((title, k)) or " ".join(sentence() for _ in range(random.randint(2, 5)))
        story.append(Paragraph(f"{n}.{k} {text}", p))
SimpleDocTemplate(f"{OUT}/outsourcing-agreement-long.pdf", pagesize=A4).build(story, onFirstPage=deco, onLaterPages=deco)
print("ok")
