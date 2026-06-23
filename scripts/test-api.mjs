import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_API_BASE });
const res = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "What is 2+2?" }],
  max_tokens: 50,
});
console.log("Full response:", JSON.stringify(res, null, 2).slice(0, 500));
console.log("Content:", res.choices?.[0]?.message?.content);
