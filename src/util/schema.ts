export type Schema =
  | { type: "string"; enum?: readonly string[]; minLength?: number }
  | { type: "number"; minimum?: number; maximum?: number }
  | { type: "boolean" }
  | { type: "array"; items: Schema; minItems?: number }
  | {
      type: "object";
      properties: Record<string, Schema>;
      required?: readonly string[];
      additionalProperties?: boolean;
    };

export function validate(schema: Schema, value: unknown, path = "$"): string[] {
  const errs: string[] = [];
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") return [`${path}: expected string, got ${typeof value}`];
      if (schema.enum && !schema.enum.includes(value))
        errs.push(`${path}: "${value}" not in [${schema.enum.join(", ")}]`);
      if (schema.minLength !== undefined && value.length < schema.minLength)
        errs.push(`${path}: length < ${schema.minLength}`);
      return errs;
    case "number":
      if (typeof value !== "number" || Number.isNaN(value)) return [`${path}: expected number`];
      if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${path}: < min`);
      if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${path}: > max`);
      return errs;
    case "boolean":
      return typeof value === "boolean" ? [] : [`${path}: expected boolean`];
    case "array": {
      if (!Array.isArray(value)) return [`${path}: expected array`];
      if (schema.minItems !== undefined && value.length < schema.minItems)
        errs.push(`${path}: fewer than ${schema.minItems} items`);
      value.forEach((v, i) => errs.push(...validate(schema.items, v, `${path}[${i}]`)));
      return errs;
    }
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        return [`${path}: expected object`];
      const obj = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (!(key in obj)) errs.push(`${path}.${key}: missing required field`);
      }
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (key in obj) errs.push(...validate(sub, obj[key], `${path}.${key}`));
      }
      if (schema.additionalProperties === false) {
        const known = new Set(Object.keys(schema.properties));
        for (const key of Object.keys(obj)) {
          if (!known.has(key)) errs.push(`${path}.${key}: unexpected field`);
        }
      }
      return errs;
    }
  }
}
