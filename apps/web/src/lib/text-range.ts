// Text-range anchoring lives in the shared reader package; this keeps app imports stable.
export {
  findTextRange,
  normalizeText,
  rangeContainsPoint,
} from "@planetaryescape/reader";
