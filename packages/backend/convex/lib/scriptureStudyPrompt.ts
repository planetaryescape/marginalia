/** Reader-facing synthesis, not an invitation to fill a checklist of lenses. */
export const STUDY_TEACHING_PROMPT = `
<task>
Write one connected, readable study of this passage, not a catalogue of facts.
Return teaching (or null if no findings) alongside the verified findings.
Aim for roughly 500–800 words total when the evidence warrants it, less for a
simple passage. Avoid repeating a paraphrase as a consequence. Plain language
matters more than theological vocabulary or original-language terminology.
</task>
<exegesis>
Start with teaching.centralReading: the passage's central claim or question and
how its argument fits together. In teaching.context explain genre, speaker,
audience and the immediate literary setting ONLY as supported by supplied text
or sources. Distinguish what the text states from reconstruction or inference;
do not invent historical circumstances, authorship conclusions or opponents.
Use findings as ordered steps in a sustained explanation of the passage's
reasoning. Give each a descriptive heading. observation explains the wording,
syntax, contrast, image or movement that matters; consequence explains how that
step advances or qualifies the central reading, not the same claim restated.
Explain why a Greek/Hebrew detail changes the reading, or leave it out.
Use the chapter context to avoid treating a phrase as a stand-alone maxim.
</exegesis>
<interpretation>
Where supplied sources support materially different readings, represent each
fairly in the relevant finding's interpretations, explaining the textual grounds, what changes and
what remains uncertain. Attribute source positions to the actual supplied source.
Do not turn several excerpts from one corpus into several scholarly stances.
Do not invent debates, denominational positions, consensus or source agreement.
If only one source reading is available, say so only when it affects the reading;
do not manufacture an opposing position to fill a slot.
Include useful finding.relatedPassages from verified supplied WEB evidence, including
connections within the same book. Explain the relationship and relevant difference,
not just a shared word. A thematic parallel is not proof of authorial borrowing.
No quota of cross-references, variants, objections or scholarly terminology.
</interpretation>
<hermeneutics>
After explaining the passage, teaching.application.principle states the principle
that follows and shows its bridge from the original literary situation.
derivedFromFindingIds identifies the verified finding steps that establish that
bridge. today is an optional plain-text illustration, not a source-verified fact:
use null when a modern behavioural example would force moralism or trivialise
a descriptive, genealogical, liturgical or otherwise non-prescriptive passage.
When appropriate, frame it explicitly as one possible response, not a new command.
boundary explains a plausible misuse or conclusion this passage does NOT warrant,
and why. Respect genre, description versus prescription, covenantal setting and
differences between the original audience and readers now where relevant.
Do not universalize a local instruction or flatten canonical tensions.
centralReading, context, application.principle and application.boundary must cite supplied WEB evidence and any additional
source needed for its claims. Citations are evidence IDs in the structured fields,
not raw IDs, invented source names, URLs or bracket markers in prose.
Use findings.limitations only for uncertainties that materially change the reading;
routine retrieval, licensing and method explanations belong to source metadata.
Locate a passage-wide interpretive issue or canonical connection at the first
finding where it affects the argument; do not repeat it at every step.
</hermeneutics>`;
