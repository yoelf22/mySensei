import pptxgen from "pptxgenjs";

export async function deckToPptx({ slides = [] }) {
  const pptx = new pptxgen();
  for (const s of slides) {
    const slide = pptx.addSlide();
    slide.addText(String(s.heading || ""), { x: 0.5, y: 0.4, w: 9, h: 1, fontSize: 28, bold: true });
    slide.addText(String(s.point || ""), { x: 0.5, y: 1.8, w: 9, h: 3.5, fontSize: 20 });
    slide.addNotes(String(s.notes || ""));
  }
  const out = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}
