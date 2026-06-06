'use strict';

const fetch = require('node-fetch');

const DDGO_API = 'https://api.duckduckgo.com/';

module.exports = {
  name: 'web_search',
  description:
    'Searches the web using the DuckDuckGo Instant Answer API and returns a plain-text summary. ' +
    'Best for factual questions, definitions, and quick lookups. Not a full web scraper.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query to look up',
      },
    },
    required: ['query'],
  },
  async run({ query }) {
    if (!query || typeof query !== 'string') return 'Error: query is required';

    const url =
      DDGO_API +
      '?q=' +
      encodeURIComponent(query.trim()) +
      '&format=json&no_redirect=1&no_html=1&skip_disambig=1';

    let data;
    try {
      const res = await fetch(url, {
        timeout: 12000,
        headers: { 'User-Agent': 'usb-llm-agent/1.0 (educational project)' },
      });
      if (!res.ok) {
        return `Search API returned HTTP ${res.status}`;
      }
      data = await res.json();
    } catch (err) {
      return `Search request failed: ${err.message}`;
    }

    // Priority: AbstractText > Answer > first RelatedTopic > Redirect suggestion
    if (data.AbstractText && data.AbstractText.trim()) {
      let result = data.AbstractText;
      if (data.AbstractURL) result += `\nSource: ${data.AbstractURL}`;
      return result;
    }

    if (data.Answer && data.Answer.trim()) {
      return `Answer: ${data.Answer}`;
    }

    if (Array.isArray(data.RelatedTopics) && data.RelatedTopics.length > 0) {
      const topics = data.RelatedTopics
        .filter((t) => t.Text)
        .slice(0, 3)
        .map((t) => `- ${t.Text}`)
        .join('\n');

      if (topics) {
        return `Related results for "${query}":\n${topics}`;
      }
    }

    if (data.Redirect) {
      return `DuckDuckGo redirects to: ${data.Redirect}`;
    }

    return `No instant answer found for "${query}". The query may be too broad or too specific for DuckDuckGo's instant answers.`;
  },
};
