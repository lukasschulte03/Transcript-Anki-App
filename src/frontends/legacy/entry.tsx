import type { LectioClient } from "../../application/lectioClient";
import App from "../../App";

/** Compatibility frontend. New code belongs in `frontends/next`. */
export default function LegacyFrontend({
  client: _client,
}: {
  client: LectioClient;
}) {
  return <App />;
}
