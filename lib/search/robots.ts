export type RobotsRule = { allow: boolean; pattern: string };

type Group = { agents: string[]; rules: RobotsRule[] };

/**
 * Skupina pravidel pro našeho agenta.
 * Když v souboru není konkrétní shoda, platí skupina `*`.
 */
export function robotsRulesFor(text: string, userAgent: string): RobotsRule[] {
  const groups: Group[] = [];
  let current: Group | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (key === "user-agent") {
      const agent = value.toLowerCase();
      if (!current || current.rules.length > 0) {
        if (current) groups.push(current);
        current = { agents: [agent], rules: [] };
      } else {
        current.agents.push(agent);
      }
      continue;
    }

    if ((key === "allow" || key === "disallow") && value) {
      current ??= { agents: ["*"], rules: [] };
      current.rules.push({ allow: key === "allow", pattern: value });
    }
  }
  if (current) groups.push(current);

  const agent = userAgent.toLowerCase();
  const specific = groups.filter((group) =>
    group.agents.some((name) => name !== "*" && agent.startsWith(name)),
  );
  const chosen = specific.length > 0 ? specific : groups.filter((group) => group.agents.includes("*"));
  return chosen.flatMap((group) => group.rules);
}

function patternMatches(pattern: string, pathAndQuery: string): boolean {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      source += ".*";
    } else if (char === "$" && index === pattern.length - 1) {
      source += "$";
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  if (!pattern.endsWith("$")) source += ".*";
  return new RegExp(source).test(pathAndQuery);
}

/**
 * Delší shoda vyhrává. Při stejné délce má přednost Allow.
 * Bez shody je adresa povolená.
 */
export function robotsAllows(rules: readonly RobotsRule[], pathAndQuery: string): boolean {
  let best: { length: number; allow: boolean } | null = null;
  for (const rule of rules) {
    if (!patternMatches(rule.pattern, pathAndQuery)) continue;
    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow && !best.allow)) {
      best = { length, allow: rule.allow };
    }
  }
  return best ? best.allow : true;
}
