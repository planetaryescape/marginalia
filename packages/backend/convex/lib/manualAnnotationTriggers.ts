import {
  annotationModelChanged,
  annotationSourceChanged,
} from "./manualAnnotations";
import { metadataTriggers } from "./metadataTriggers";

metadataTriggers.register("articles", (ctx, change) =>
  annotationSourceChanged(
    { ...ctx, db: ctx.innerDb },
    change.oldDoc,
    change.newDoc,
  ),
);
metadataTriggers.register("userSettings", (ctx, change) =>
  annotationModelChanged(
    { ...ctx, db: ctx.innerDb },
    change.oldDoc,
    change.newDoc,
  ),
);
