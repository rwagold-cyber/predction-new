import { useState } from 'react';
import { createWallet, getMarketRegistryContract } from '../lib/ethers';
import { USDC_ADDRESS, ORACLE_ADAPTER_ADDRESS } from '../lib/contracts';

export default function MarketCreator() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [timeframe, setTimeframe] = useState('5');

  const handleCreateMarket = async () => {
    const marketCreatorPK = import.meta.env.VITE_MARKET_CREATOR_PK;
    if (!marketCreatorPK) {
      alert('VITE_MARKET_CREATOR_PK not configured!');
      return;
    }

    setLoading(true);
    setStatus('Creating market...');

    try {
      const wallet = createWallet(marketCreatorPK);
      const registry = getMarketRegistryContract(wallet);

      const now = Math.floor(Date.now() / 1000);
      const nextMinute = Math.ceil((now + 60) / 60) * 60;

      setStatus('Submitting transaction...');
      const tx = await registry.createMarket(USDC_ADDRESS, ORACLE_ADAPTER_ADDRESS, nextMinute, 0, parseInt(timeframe));

      setStatus('Waiting for confirmation...');
      const receipt = await tx.wait();

      const nextMarketId = await registry.nextMarketId();
      const marketId = Number(nextMarketId) - 1;

      const startTimeStr = new Date(nextMinute * 1000).toLocaleString();
      setStatus(`Market ${marketId} created! Start time: ${startTimeStr}`);
      setTimeout(() => setStatus(''), 5000);
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
      console.error('Market creation failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', border: '2px solid #FF9800', borderRadius: '8px', backgroundColor: '#fff3e0' }}>
      <h3 style={{ marginTop: 0, color: '#FF9800' }}>Market Creator (Testing Only)</h3>
      <div style={{ fontSize: '12px', color: '#666', marginBottom: '15px', padding: '10px', backgroundColor: '#ffe0b2', borderRadius: '4px' }}>
        WARNING: This uses a test account with MARKET_CREATOR_ROLE. Only for local testing!
      </div>
      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Timeframe (minutes):</label>
        <select value={timeframe} onChange={(e) => setTimeframe(e.target.value)} style={{ width: '100%', padding: '8px', fontSize: '14px' }}>
          <option value="1">1 minute</option>
          <option value="3">3 minutes</option>
          <option value="5">5 minutes</option>
          <option value="10">10 minutes</option>
          <option value="15">15 minutes</option>
        </select>
      </div>
      <button onClick={handleCreateMarket} disabled={loading} style={{ width: '100%', padding: '12px', fontSize: '16px', fontWeight: 'bold', backgroundColor: '#FF9800', color: 'white', border: 'none', borderRadius: '4px', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}>
        {loading ? 'Creating...' : 'Create Market'}
      </button>
      {status && (
        <div style={{ marginTop: '15px', padding: '10px', backgroundColor: status.includes('Error') ? '#ffcdd2' : '#c8e6c9', color: status.includes('Error') ? '#c62828' : '#2e7d32', borderRadius: '4px', fontSize: '12px' }}>
          {status}
        </div>
      )}
    </div>
  );
}
