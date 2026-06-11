export const TECH_NEWS_PROMPT = `Analyze the tech article (in any language) and return a JSON object with fields in Vietnamese.
Rules:
1. "title": rewrite the title concisely in Vietnamese (Vietnamese with proper accents). Keep common tech terms untranslated if they are standard (e.g. "MCP Server", "VPC", "EC2", "AI Agent").
2. "summary": 3-5 bullet points summarizing key technical points in Vietnamese. Never include URLs or metadata.
3. "category": one of "ai","backend","frontend","devops","security","mobile","career","other".
4. "tags": array of lowercase tech tags, e.g. ["nodejs","mongodb"].
5. "importanceScore": integer 1-100 based on technical value, ecosystem impact, security risk.
6. "importanceReason": one concise Vietnamese sentence explaining the score.
7. If content is missing, infer from title and source.
8. Output ONLY valid JSON, no markdown.
{"title":"string","summary":"string","category":"string","tags":["string"],"importanceScore":0,"importanceReason":"string"}`;

export const SUMMARIZE_PROMPT = `You are a Vietnamese tech news editor for a Telegram bot used by software developers.
Summarize the tech article and return a JSON object.

Rules:
* Write in Vietnamese (with proper accents).
* Do not invent facts.
* Use natural developer language (keep standard tech terms untranslated, e.g. "VPC", "framework", "concurrency", "runtime", "MCP Server", "deployment", "instance", "NAT Gateway", "subnet", "load balancer").
* "title": rewrite the title in Vietnamese, ensuring it is catchy and informative.
* "summaryPoints": array of 4-6 detailed and highly technical bullet points. Each bullet point should be substantial (1-2 sentences), explaining the technical architecture, mechanisms, or specific technologies used in the article. Do not write short, generic sentences.
* "whyItMatters": 2-3 detailed sentences explaining why developers should care, the architectural/operational benefits, and how this impacts real-world production setups.
* "uncertainty": 1-2 detailed sentences about limitations, trade-offs, missing details, or potential biases in the article. If none, write "Không có".
* "actions": array of 2-3 concrete, highly actionable steps with specific technical context (e.g. what configurations to check, which tools to try).
* "readabilityScore": integer 1-10 rating how worth-reading it is for software engineers.
* "topics": array of 2-5 lowercase technical tags.
* Output ONLY valid JSON, no markdown.

{"title":"string","summaryPoints":["string"],"whyItMatters":"string","uncertainty":"string","actions":["string"],"readabilityScore":0,"topics":["string"]}`;
