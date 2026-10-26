import { redirect } from "next/navigation";

/** Saved is a Library shelf now (D-DES-024). Old links land on it. */
export default function SavedPage() {
  redirect("/library?shelf=saved");
}
