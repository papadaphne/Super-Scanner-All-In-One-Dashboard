
import React from 'react';
import CodeBlock from './CodeBlock';
import Card from './Card';
import { AI_PROMPT, AI_EXAMPLE_OUTPUT } from '../constants';

const AIPromptView: React.FC = () => {
  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-2">Gemini AI Prompt for Signal Generation</h1>
      <p className="text-gray-400 mb-6">
        Use this prompt with a powerful AI model like Gemini to create an assistant that can analyze market data and generate structured trading signals.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="The Prompt">
            <p className="text-sm text-gray-300 mb-4">
              This prompt instructs the AI to act as a crypto market scanner. It defines the input (Indodax API data), the required analysis steps, and the precise JSON output format.
            </p>
          <CodeBlock code={AI_PROMPT} language="text" />
        </Card>
        <Card title="Example JSON Output">
            <p className="text-sm text-gray-300 mb-4">
              The AI will generate a JSON object like the one below, containing an array of high-priority signals. This structured data can be easily consumed by other applications or dashboards.
            </p>
          <CodeBlock code={AI_EXAMPLE_OUTPUT} language="json" />
        </Card>
      </div>
    </div>
  );
};

export default AIPromptView;
