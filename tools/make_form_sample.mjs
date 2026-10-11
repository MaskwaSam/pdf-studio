// Generates form-sample.pdf: a page with real AcroForm fields + labels + a signature line.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "fs";

const doc = await PDFDocument.create();
const page = doc.addPage([612, 792]);
const helv = await doc.embedFont(StandardFonts.Helvetica);
const helvB = await doc.embedFont(StandardFonts.HelveticaBold);
doc.setTitle("Intake Form");

page.drawText("Client Intake Form", { x: 72, y: 730, size: 22, font: helvB, color: rgb(0.1, 0.1, 0.3) });
page.drawText("Name:", { x: 72, y: 680, size: 12, font: helv });
page.drawText("Email:", { x: 72, y: 640, size: 12, font: helv });
page.drawText("Notes:", { x: 72, y: 600, size: 12, font: helv });
page.drawText("Subscribe to newsletter", { x: 210, y: 555, size: 12, font: helv });
page.drawText("Plan:", { x: 72, y: 515, size: 12, font: helv });
page.drawText("Basic", { x: 130, y: 480, size: 12, font: helv });
page.drawText("Pro", { x: 130, y: 458, size: 12, font: helv });
page.drawText("Country:", { x: 72, y: 415, size: 12, font: helv });
page.drawText("Signature:", { x: 72, y: 330, size: 12, font: helv });
page.drawLine({ start: { x: 140, y: 325 }, end: { x: 420, y: 325 }, thickness: 0.7, color: rgb(0.4, 0.4, 0.4) });

const form = doc.getForm();

const name = form.createTextField("client.name");
name.addToPage(page, { x: 140, y: 672, width: 260, height: 20, borderWidth: 1, borderColor: rgb(0.5, 0.5, 0.5) });
const email = form.createTextField("client.email");
email.addToPage(page, { x: 140, y: 632, width: 260, height: 20, borderWidth: 1, borderColor: rgb(0.5, 0.5, 0.5) });
const notes = form.createTextField("client.notes");
notes.enableMultiline();
notes.addToPage(page, { x: 140, y: 570, width: 260, height: 55, borderWidth: 1, borderColor: rgb(0.5, 0.5, 0.5) });

const cb = form.createCheckBox("subscribe");
cb.addToPage(page, { x: 190, y: 551, width: 16, height: 16, borderWidth: 1, borderColor: rgb(0.5, 0.5, 0.5) });

const rg = form.createRadioGroup("plan");
rg.addOptionToPage("basic", page, { x: 110, y: 476, width: 15, height: 15 });
rg.addOptionToPage("pro", page, { x: 110, y: 454, width: 15, height: 15 });

const dd = form.createDropdown("country");
dd.addOptions(["Canada", "United States", "Other"]);
dd.addToPage(page, { x: 140, y: 407, width: 180, height: 22, borderWidth: 1, borderColor: rgb(0.5, 0.5, 0.5) });

fs.writeFileSync("form-sample.pdf", await doc.save());
console.log("wrote form-sample.pdf");
