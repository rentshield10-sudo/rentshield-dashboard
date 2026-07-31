// Allows dot-namespaced names (e.g. {{Appliance.type.1}}) in addition to
// plain identifiers, since some variables are more readable grouped that way.
const VARIABLE_PATTERN = /\{\{([\w.]+)\}\}/g;

export function extractVariableNames(templateBody: string): string[] {
  const names = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(VARIABLE_PATTERN);
  while ((match = re.exec(templateBody)) !== null) {
    names.add(match[1]);
  }
  return Array.from(names);
}

export function substituteVariables(templateBody: string, values: Record<string, string>): string {
  return templateBody.replace(VARIABLE_PATTERN, (full, name: string) => {
    const value = values[name];
    return value !== undefined && value !== "" ? value : full;
  });
}
