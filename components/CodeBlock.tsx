
import React, { useState } from 'react';
import { CopyIcon } from './icons/CopyIcon';
import { CheckIcon } from './icons/CheckIcon';

interface CodeBlockProps {
  code: string;
  language: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ code, language }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="bg-gray-900 rounded-lg my-4 relative border border-gray-700">
      <div className="flex justify-between items-center px-4 py-2 bg-gray-700 rounded-t-lg">
        <span className="text-xs font-semibold text-gray-400 uppercase">{language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center text-xs text-gray-300 hover:text-white transition"
        >
          {copied ? (
            <>
              <CheckIcon /> <span className="ml-1">Copied!</span>
            </>
          ) : (
            <>
              <CopyIcon /> <span className="ml-1">Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 text-sm overflow-x-auto">
        <code className={`language-${language}`}>{code}</code>
      </pre>
    </div>
  );
};

export default CodeBlock;
