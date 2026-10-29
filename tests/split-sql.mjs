// Splits a SQL file into single statements (respects $$ ... $$ bodies, quoted text and comments).
export function splitSql(text) {
  const out = []; let cur = ''; let i = 0; let dollar = null;
  while (i < text.length) {
    const c = text[i]; const rest = text.slice(i);
    if (dollar) { if (rest.startsWith(dollar)) { cur += dollar; i += dollar.length; dollar = null; } else { cur += c; i++; } continue; }
    if (rest.startsWith('--')) { const e = text.indexOf('\n', i); const end = e === -1 ? text.length : e; i = end; continue; }
    const m = /^\$[A-Za-z_]*\$/.exec(rest);
    if (m) { dollar = m[0]; cur += dollar; i += dollar.length; continue; }
    if (c === "'") { let j = i + 1; while (j < text.length) { if (text[j] === "'" && text[j + 1] === "'") j += 2; else if (text[j] === "'") break; else j++; } cur += text.slice(i, j + 1); i = j + 1; continue; }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
