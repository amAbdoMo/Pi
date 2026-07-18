import { Type } from "typebox";

export function StringEnum(values: readonly string[], options: Record<string, unknown> = {}) {
  return Type.Union(values.map((value) => Type.Literal(value)), options);
}
