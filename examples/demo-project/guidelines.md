# Demo project: HPO phenotype annotation guidelines

Short rules for the Ontotator demo project. The texts are invented clinical letters; no real patient is described.

## Quick reference

| Situation | What you do |
| --- | --- |
| A finding of the patient is described | Mark it, pick the most specific fitting HPO term, **Assertion** Present |
| The text says the finding is not there ("no ptosis", "hearing is normal") | Mark it, **Assertion** Absent |
| The text hedges ("may", "possible", "suspected") | Mark it, **Assertion** Uncertain |
| The finding belongs to a relative ("her mother has migraine") | **Experiencer** Family member |
| The finding is over ("had a depressive episode in 2015, which has resolved") | **Temporality** Historical |
| The same finding is named again | Add the new passage as a second mention of the same finding |

## R0 What is annotated

Annotate phenotypes: signs, symptoms, examination findings and abnormal test results. Do not annotate diagnoses of other diseases as such, treatments, normal test results without a named finding, or the closing line "Synthetic demonstration case".

## R1 Term choice

1. Pick the most specific HPO term the text supports. "Tremor at rest" is **Resting tremor**, not **Tremor**.
2. Do not go more specific than the text. "Weakness of both feet" is **Distal muscle weakness**, not a term for one muscle.
3. If no term fits well, choose the closest more general term and write a note.

## R2 Span

1. Mark the shortest passage that carries the finding: "proximal muscle weakness", not the whole sentence.
2. Leave out the negation and hedge words ("no", "possible") from the span; they go into the values.
3. A finding in several places gets one finding with several mentions.

## R3 Values

- **Assertion**: Present, Absent or Uncertain, as the text states it.
- **Experiencer**: Patient, or Family member for relatives. Other person for anybody else.
- **Temporality**: Current, or Historical for findings that are over.

Confirm every prefilled value: it counts as not chosen until you do.

## R4 Tool proposals

Tool proposals are suggestions, not facts. Check the passage, the term and every value of each one. **Confirm** it only if all are right. Use **Edit & Replace** if it is nearly right: a wrong value (a missed "no", a relative instead of the patient) or a too general or wrong term. **Reject** it if the passage holds no phenotype. Then read the text again and add what the tool missed.

## R5 Translated texts

Annotate the English translation. If the translation says something the source does not (a missing "no", a wrong number), report it in the translation review instead of annotating around it.
