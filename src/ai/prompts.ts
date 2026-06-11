export const TECH_NEWS_PROMPT = `Analyze the tech article and return a JSON object.
Rules:
1. "title": rewrite the title concisely in English.
2. "summary": 3-5 bullet points summarizing key technical points in English. Never include URLs or metadata.
3. "category": one of "ai","backend","frontend","devops","security","mobile","career","other".
4. "tags": array of lowercase tech tags, e.g. ["nodejs","mongodb"].
5. "importanceScore": integer 1-100 based on technical value, ecosystem impact, security risk.
6. "importanceReason": one English sentence explaining the score.
7. If content is missing, infer from title and source.
8. Output ONLY valid JSON, no markdown.
{"title":"string","summary":"string","category":"string","tags":["string"],"importanceScore":0,"importanceReason":"string"}`;
