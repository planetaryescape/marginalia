import { abortable } from "./abortable";
import { postReaderRequest, type ReaderTransport } from "./reader-transport";

export { resetDirectBackoff } from "./reader-transport";
export type TopicSearchTransport = ReaderTransport;

/** Direct JWT transport, preserving the old proxy paths and JSON contract. */
export async function postTopicSearch(
  path: "find" | "search",
  question: string,
  signal: AbortSignal,
  transport?: TopicSearchTransport,
) {
  const response = await postReaderRequest(
    `library/${path}`,
    { question },
    signal,
    transport,
  );
  if (!response.ok) throw response;
  return abortable(response.json(), signal);
}
