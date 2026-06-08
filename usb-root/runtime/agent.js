'use strict';

const fetch = require('node-fetch');
const { getPlugins } = require('./plugin-loader');

function buildSystemPrompt(plugins) {
  const toolDocs = plugins
    .map((p) => {
      return [
        `Tool: ${p.name}`,
        `Description: ${p.description}`,
        `Parameters: ${JSON.stringify(p.parameters, null, 2)}`,
      ].join('\n');
    })
    .join('\n\n---\n\n');

  return `You are an autonomous agent. You complete tasks by calling tools one step at a time.

CRITICAL RULES:
- ALWAYS respond with a single raw JSON object. No prose. No markdown. No code fences. No explanation outside the JSON.
- Every response must be parseable by JSON.parse().
- If the user is just chatting or asking a question that needs no tool, use "finish" immediately with your answer as the result.
- NEVER output "undefined", null, or a made-up tool name as the action.

Available tools:
${toolDocs}

Format for calling a tool:
{"thought":"your reasoning about what to do next","action":"tool_name","params":{"param1":"value1"}}

Format for finishing (use this for answers, conversation, and completed tasks):
{"thought":"your reasoning","action":"finish","result":"your answer or summary"}

Rules:
- Use "finish" when the task is done, no tool is needed, or you are answering a question.
- Params must match the tool's parameter schema exactly.
- If a tool returns an error, adapt your approach.
- Never call a tool that is not in the available tools list.
- Respond ONLY with the JSON object. Nothing before it. Nothing after it.`;
}

async function callOllama({ url, model, messages }) {
  const res = await fetch(`${url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: { temperature: 0.1 },
    }),
    timeout: 180000,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.message || !data.message.content) {
    throw new Error('Ollama response missing message.content');
  }
  return data.message.content;
}

async function callLlamaCpp({ url, model, messages }) {
  const res = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.1,
      stream: false,
    }),
    timeout: 180000,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`llama.cpp HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('llama.cpp response missing choices[0].message');
  }
  return data.choices[0].message.content;
}

async function callLLM({ llmUrl, llmMode, model, messages }) {
  if (llmMode === 'llamacpp') {
    return callLlamaCpp({ url: llmUrl, model, messages });
  }
  return callOllama({ url: llmUrl, model, messages });
}

function parseResponse(raw) {
  // Strip any accidental markdown code fences
  const cleaned = raw
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  // Try to extract first JSON object if there's surrounding text
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new SyntaxError('No JSON object found in response');
  }

  return JSON.parse(jsonMatch[0]);
}

async function runAgent({
  id,
  prompt,
  llmUrl,
  llmMode,
  model,
  maxIterations,
  config,
  onStep,
  onFinish,
  onError,
}) {
  const plugins = getPlugins();
  const systemPrompt = buildSystemPrompt(plugins);

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    // --- LLM call with parse-failure retry ---
    let rawContent;
    let parsed;
    let parseAttempts = 0;
    const maxParseRetries = 3;

    while (parseAttempts < maxParseRetries) {
      try {
        rawContent = await callLLM({ llmUrl, llmMode, model, messages });
      } catch (llmErr) {
        onError(new Error(`LLM call failed on iteration ${iteration}: ${llmErr.message}`));
        return;
      }

      try {
        parsed = parseResponse(rawContent);
        break; // success
      } catch (parseErr) {
        parseAttempts++;
        if (parseAttempts >= maxParseRetries) {
          onStep({
            type: 'parse_failure',
            thought: null,
            action: null,
            params: null,
            observation: `LLM returned non-JSON after ${maxParseRetries} attempts. Last response: ${rawContent.slice(0, 500)}`,
          });
          onError(new Error(`LLM returned unparseable JSON after ${maxParseRetries} attempts`));
          return;
        }
        // Inject correction prompt and retry LLM call
        messages.push({ role: 'assistant', content: rawContent });
        messages.push({
          role: 'user',
          content:
            `Your response was not valid JSON. Parse error: ${parseErr.message}\n` +
            'You must respond with ONLY a raw JSON object. No markdown. No explanation. No code fences.\n' +
            'Try again.',
        });
      }
    }

    const { thought, params, result } = parsed;
    // Treat missing, null, or "undefined" action as finish to handle model confusion
    const action = (parsed.action && parsed.action !== 'undefined' && parsed.action !== 'null')
      ? parsed.action
      : 'finish';

    // --- Handle finish ---
    if (action === 'finish') {
      const finalResult = result !== undefined ? String(result) : 'Task completed.';
      onStep({
        type: 'finish',
        thought: thought || '',
        action: 'finish',
        params: null,
        observation: finalResult,
      });
      onFinish(finalResult);
      return;
    }

    // --- Find and run plugin ---
    const plugin = plugins.find((p) => p.name === action);
    let observation;

    if (!plugin) {
      observation = `Error: Tool "${action}" not found. Available tools: ${plugins.map((p) => p.name).join(', ')}`;
    } else {
      try {
        const output = await plugin.run(params || {});
        observation = typeof output === 'string' ? output : JSON.stringify(output);
      } catch (pluginErr) {
        observation = `Tool error in "${action}": ${pluginErr.message}`;
      }
    }

    onStep({
      type: 'step',
      thought: thought || '',
      action: action || '',
      params: params || {},
      observation,
    });

    // Append to conversation history
    messages.push({
      role: 'assistant',
      content: JSON.stringify({ thought, action, params }),
    });
    messages.push({
      role: 'user',
      content: `Observation: ${observation}`,
    });
  }

  const limitMsg = `Reached maximum iterations (${maxIterations}) without completing. Last action attempted.`;
  onFinish(limitMsg);
}

module.exports = { runAgent };
