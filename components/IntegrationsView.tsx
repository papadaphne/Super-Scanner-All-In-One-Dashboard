import React, { useState } from 'react';
import CodeBlock from './CodeBlock';
import Card from './Card';
import { PINE_SCRIPT_CODE, SYSTEMD_CODE, DEPLOYMENT_COMMANDS, TELEGRAM_SETUP_TEXT, BACKEND_CODE } from '../constants';

type IntegrationTab = 'tradingview' | 'deployment' | 'live_backend';

const TabButton: React.FC<{
  label: string;
  isActive: boolean;
  onClick: () => void;
}> = ({ label, isActive, onClick }) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 text-sm font-medium rounded-md transition-colors duration-200 ${
      isActive
        ? 'bg-primary text-white'
        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
    }`}
  >
    {label}
  </button>
);

const IntegrationsView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<IntegrationTab>('live_backend');

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-2">Applications & Integrations</h1>
      <p className="text-gray-400 mb-6">
        Connect the Super-Scanner bot and its signals to other platforms for a complete trading workflow.
      </p>

      <div className="mb-6 flex space-x-2 border-b border-gray-700 pb-4">
        <TabButton label="Live Backend" isActive={activeTab === 'live_backend'} onClick={() => setActiveTab('live_backend')} />
        <TabButton label="TradingView Indicator" isActive={activeTab === 'tradingview'} onClick={() => setActiveTab('tradingview')} />
        <TabButton label="Telegram & Deployment" isActive={activeTab === 'deployment'} onClick={() => setActiveTab('deployment')} />
      </div>

      <div>
        {activeTab === 'live_backend' && (
            <Card title="Making It Real: Live Backend Server">
                <p className="text-sm text-gray-300 mb-4">
                  To make the dashboard show real, live data, you need to run the Python scanner logic as a backend server. This server will analyze market data and provide it to this web interface through an API.
                </p>
                
                <h4 className="font-semibold text-white mb-2 mt-6">1. Install Dependencies</h4>
                <p className="text-sm text-gray-400 mb-2">You'll need Python 3 and a few packages. Install them using pip:</p>
                <CodeBlock code="pip install Flask Flask-Cors requests" language="bash" />
                
                <h4 className="font-semibold text-white mb-2 mt-6">2. Save the Backend Code</h4>
                <p className="text-sm text-gray-400 mb-2">Create a new folder named <code className="bg-gray-700 p-1 rounded text-xs">backend</code> and save the following code as <code className="bg-gray-700 p-1 rounded text-xs">server.py</code> inside it.</p>
                <CodeBlock code={BACKEND_CODE} language="python" />

                <h4 className="font-semibold text-white mb-2 mt-6">3. Run the Server</h4>
                <p className="text-sm text-gray-400 mb-2">Navigate to the <code className="bg-gray-700 p-1 rounded text-xs">backend</code> directory in your terminal and run the server:</p>
                <CodeBlock code="python server.py" language="bash" />

                <h4 className="font-semibold text-white mb-2 mt-6">4. View Live Data</h4>
                <p className="text-sm text-gray-300">
                    Once the server is running, go back to the <span className="font-bold text-primary">Dashboard</span> tab in this application. It will automatically connect to your local server and display any signals as they are found.
                </p>
            </Card>
        )}

        {activeTab === 'tradingview' && (
          <Card title="TradingView Indicator (Pine Script v5)">
            <p className="text-sm text-gray-300 mb-4">
              This Pine Script indicator provides visual breakout and scalper signals directly on your TradingView charts. Use it for manual confirmation of bot signals.
            </p>
            <CodeBlock code={PINE_SCRIPT_CODE} language="pinescript" />
          </Card>
        )}

        {activeTab === 'deployment' && (
          <div className="space-y-6">
            <Card title="Telegram Bot Setup">
              <p className="text-sm text-gray-300 mb-4 whitespace-pre-wrap font-mono">{TELEGRAM_SETUP_TEXT}</p>
            </Card>
            <Card title="VPS Deployment Guide (systemd)">
                <p className="text-sm text-gray-300 mb-4">
                  To run the bot 24/7, deploy it on a Virtual Private Server (VPS) using a systemd service. This ensures it automatically restarts if it crashes or the server reboots.
                </p>
                <h4 className="font-semibold text-white mb-2">1. Create the service file</h4>
                <p className="text-sm text-gray-400 mb-2">Create a file at <code className="bg-gray-700 p-1 rounded text-xs">/etc/systemd/system/super_scanner.service</code> with this content:</p>
                <CodeBlock code={SYSTEMD_CODE} language="ini" />

                <h4 className="font-semibold text-white mb-2 mt-6">2. Reload, enable, and start the service</h4>
                 <p className="text-sm text-gray-400 mb-2">Run these commands to manage the service. The last command lets you view live logs.</p>
                <CodeBlock code={DEPLOYMENT_COMMANDS} language="bash" />
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

export default IntegrationsView;
