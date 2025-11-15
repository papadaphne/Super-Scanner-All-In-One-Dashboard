import React, { useState, useEffect } from 'react';
import { Signal } from '../types';

const modeColors: { [key in Signal['mode']]: string } = {
  scalper: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  micro_pump: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  breakout: 'bg-green-500/20 text-green-400 border-green-500/30',
  accumulation: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  rebound: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  lowcap: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
};

const getRsiInfo = (rsi: number): { text: string; color: string } => {
    if (rsi < 35) return { text: 'Oversold', color: 'text-green-400' };
    if (rsi > 70) return { text: 'Overbought', color: 'text-red-400' };
    return { text: 'Neutral', color: 'text-gray-400' };
}

const SignalCard: React.FC<{ signal: Signal }> = ({ signal }) => {
    // FIX: Add a check for signal.rsi to prevent crashes if the value is undefined.
    const hasRsi = typeof signal.rsi === 'number';
    const rsiInfo = getRsiInfo(hasRsi ? signal.rsi : 50); // Default to neutral if RSI is missing for color calculation

    return (
        <div className={`bg-gray-800 border ${modeColors[signal.mode]} rounded-lg shadow-lg p-4 mb-4 animate-fadeIn`}>
            <div className="flex justify-between items-start">
                <div>
                    <span className={`text-xs font-bold uppercase px-2 py-1 rounded-full ${modeColors[signal.mode]}`}>
                        {signal.mode.replace('_', ' ')}
                    </span>
                    <h3 className="text-xl font-bold mt-2 text-white">{signal.pair.toUpperCase().replace('_', '/')}</h3>
                    <p className="text-xs text-gray-400">{signal.time}</p>
                </div>
                <div className="text-right">
                    <p className="text-sm text-gray-400">Priority</p>
                    <p className="text-2xl font-bold text-primary">{signal.priority.toFixed(1)}</p>
                </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                <div>
                    <p className="text-xs text-gray-400 uppercase">Entry</p>
                    <p className="font-mono text-white">{signal.entry.toLocaleString('id-ID')}</p>
                </div>
                <div>
                    <p className="text-xs text-gray-400 uppercase">Take Profit</p>
                    <p className="font-mono text-green-400">{signal.tp.toLocaleString('id-ID')}</p>
                </div>
                <div>
                    <p className="text-xs text-gray-400 uppercase">Stop Loss</p>
                    <p className="font-mono text-red-400">{signal.sl.toLocaleString('id-ID')}</p>
                </div>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-700 grid grid-cols-3 gap-4 text-xs text-gray-400 text-center">
                 <div>
                    <span>Ghost: <span className={signal.ghost > 0 ? 'text-green-400' : 'text-red-400'}>{signal.ghost.toFixed(1)}</span></span>
                </div>
                <div>
                     <span>RSI (14): 
                        {hasRsi
                            ? <span className={rsiInfo.color}>{signal.rsi.toFixed(1)}</span>
                            : <span className="text-gray-500">N/A</span>
                        }
                     </span>
                </div>
                 <div>
                    <span>News: <span className={signal.news ? 'text-yellow-400' : 'text-gray-500'}>{signal.news ? 'Yes' : 'No'}</span></span>
                </div>
            </div>
        </div>
    );
}

const DashboardView: React.FC = () => {
    const [signals, setSignals] = useState<Signal[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchSignals = async () => {
            try {
                // The backend server runs on localhost:5000
                const response = await fetch('http://127.0.0.1:5000/api/signals');
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                
                setSignals(data);
                setError(null);
            } catch (e) {
                console.error("Failed to fetch signals:", e);
                setError("Could not connect to the Super-Scanner backend. Please ensure it's running on http://127.0.0.1:5000.");
            } finally {
                setIsLoading(false);
            }
        };

        fetchSignals(); // Initial fetch
        const interval = setInterval(fetchSignals, 5000); // Poll every 5 seconds

        return () => clearInterval(interval); // Cleanup on component unmount
    }, []);

    const renderContent = () => {
        if (isLoading) {
            return <p className="text-center text-gray-400">Initializing connection to backend...</p>;
        }
        if (error) {
            return (
                <div className="bg-red-900/50 border border-red-500/30 text-red-300 p-4 rounded-lg text-center">
                    <h3 className="font-bold mb-2">Connection Error</h3>
                    <p className="text-sm">{error}</p>
                    <p className="text-sm mt-2">You can find instructions to run the backend in the 'Integrations' tab.</p>
                </div>
            );
        }
        if (signals.length === 0) {
            return <p className="text-center text-gray-400">Waiting for new signals from the backend... This might take a moment.</p>;
        }
        return signals.map(signal => <SignalCard key={signal.id} signal={signal} />);
    }

    return (
        <div>
            <h1 className="text-3xl font-bold text-white mb-2">Live Signals (Real)</h1>
            <p className="text-gray-400 mb-6">This is a live feed of signals from the Python backend, now enhanced with RSI for better accuracy.</p>
            
            <div className="max-w-2xl mx-auto">
                {renderContent()}
            </div>
        </div>
    );
};

export default DashboardView;