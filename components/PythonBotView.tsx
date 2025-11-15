
import React from 'react';
import CodeBlock from './CodeBlock';
import Card from './Card';
import { PYTHON_CODE } from '../constants';

const PythonBotView: React.FC = () => {
  const features = [
    "Polls Indodax API for market data with a stability-first approach.",
    "Includes multiple detection modules: Scalper, Micro Pump, Breakout, Accumulation (Ghost Bandar), Fast Rebound, and Lowcap.",
    "Features a scoring system to prioritize the most promising signals.",
    "Automatically calculates suggested Entry, Take Profit (TP), and Stop Loss (SL) levels.",
    "Sends real-time alerts to a configured Telegram chat.",
    "Highly configurable through a simple `.env` file."
  ];

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-2">Super-Scanner Python Bot</h1>
      <p className="text-gray-400 mb-6">
        This is the complete, single-file runnable Python bot. It's designed for easy deployment and continuous operation on a server.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
            <Card title="Full Bot Code (super_scanner_bot.py)">
                <CodeBlock code={PYTHON_CODE} language="python" />
            </Card>
        </div>
        <div>
            <Card title="Key Features">
                <ul className="space-y-3">
                    {features.map((feature, index) => (
                        <li key={index} className="flex items-start">
                             <svg className="w-5 h-5 text-primary mr-2 flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                            <span className="text-gray-300 text-sm">{feature}</span>
                        </li>
                    ))}
                </ul>
            </Card>
        </div>
      </div>
    </div>
  );
};

export default PythonBotView;
