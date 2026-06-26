import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";

function bodyParas(text) {
  return String(text || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    .map((p) => new Paragraph({ children: [new TextRun(p)] }));
}

export async function paperToDocx(paper, references = []) {
  const children = [];
  children.push(new Paragraph({ text: paper.title || "", heading: HeadingLevel.TITLE }));
  if (paper.subtitle) children.push(new Paragraph({ children: [new TextRun({ text: paper.subtitle, italics: true })] }));
  if (paper.abstract) {
    children.push(new Paragraph({ text: "Abstract", heading: HeadingLevel.HEADING_1 }));
    children.push(...bodyParas(paper.abstract));
  }
  for (const s of paper.sections || []) {
    children.push(new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_1 }));
    children.push(...bodyParas(s.body));
  }
  if (paper.conclusion) {
    children.push(new Paragraph({ text: "Conclusion", heading: HeadingLevel.HEADING_1 }));
    children.push(...bodyParas(paper.conclusion));
  }
  children.push(new Paragraph({ text: "References", heading: HeadingLevel.HEADING_1 }));
  (references || []).forEach((r, i) => {
    children.push(new Paragraph({ children: [new TextRun(`[${i + 1}] ${r.title || r.url} — ${r.url}`)] }));
  });
  const doc = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}
