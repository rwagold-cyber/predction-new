import { useState } from 'react';
import { ethers } from 'ethers';
import { createWallet, signOrder, parsePriceToPips, parseUSDC, OrderV2 } from '../lib/ethers';
import { USDC_ADDRESS, CHAIN_ID, SETTLEMENT_ADDRESS } from '../lib/contracts';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

interface Market {
  id: string;
  conditionId: string;
  startTime: number;
  endTime: number;
  resolved: boolean;
}

interface TradeFormProps {
  market: Market;
  account: { label: string; address: string; privateKey: string } | null;
  outcome: number;
  side: 'buy' | 'sell';
  onOrderSubmitted: (order: {
    orderId: string;
    marketId: string;
    outcome: number;
    side: 'buy' | 'sell';
    pricePips: string;
    amount: string;
    timestamp: number;
  }) => void;
}

export default function TradeForm({ market, account, outcome, side, onOrderSubmitted }: TradeFormProps) {
  const [price, setPrice] = useState('0.5');
  const [amount, setAmount] = useState('10');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  const handleSubmit = async () => {
    if (!account) {
      setStatus('Please select an account first');
      return;
    }

    if (!price || !amount) {
      setStatus('Please enter price and amount');
      return;
    }

    setLoading(true);
    setStatus('Signing order...');

    try {
      const wallet = createWallet(account.privateKey);

      const pricePips = parsePriceToPips(price);
      const amountPips = parseUSDC(amount).toString();
      const saltHex = ethers.hexlify(ethers.randomBytes(16));

      const order: OrderV2 = {
        maker: account.address,
        marketId: market.id,
        conditionId: market.conditionId,
        outcome,
        collateral: USDC_ADDRESS,
        pricePips,
        amount: amountPips,
        makerFeeBps: 30,
        takerFeeBps: 30,
        expiry: Math.floor(Date.now() / 1000) + 86400, // 默认 24h
        salt: BigInt(saltHex).toString(),
        nonce: Math.floor(Date.now() / 1000),
        mintOnFill: true, // 双向匹配系统：所有订单都需要 mint
        allowedTaker: '0x0000000000000000000000000000000000000000',
        chainId: CHAIN_ID,
        verifyingContract: SETTLEMENT_ADDRESS,
      };

      setStatus('Signing with EIP-712...');
      const signature = await signOrder(wallet, order);

      setStatus('Submitting to API...');
      const response = await fetch(`${API_URL}/api/v1/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order, signature, side }),
      });

      const data = await response.json();

      if (data.success) {
        setStatus(`Order submitted! ID: ${data.orderId}`);
        onOrderSubmitted({
          orderId: data.orderId,
          marketId: market.id,
          outcome,
          side,
          pricePips,
          amount: amountPips,
          timestamp: Date.now(),
        });
        setTimeout(() => setStatus(''), 3000);
      } else {
        setStatus(`Error: ${data.error}`);
      }
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
      console.error('Order submission failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const borderColor = side === 'buy' ? '#4CAF50' : '#f44336';
  const bgColor = side === 'buy' ? '#e8f5e9' : '#ffebee';
  const sideUpper = side.toUpperCase();

  return (
    <div style={{ padding: '20px', border: `2px solid ${borderColor}`, borderRadius: '8px', backgroundColor: bgColor }}>
      <h3 style={{ margin: '0 0 15px 0', color: borderColor, textTransform: 'uppercase' }}>
        {sideUpper} {outcome === 1 ? 'UP' : 'DOWN'}
      </h3>

      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Price (0-1):</label>
        <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} step="0.01" min="0" max="1" style={{ width: '100%', padding: '8px', fontSize: '14px' }} />
        <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>Example: 0.5 = 50% probability</div>
      </div>

      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Amount (USDC):</label>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} step="1" min="1" style={{ width: '100%', padding: '8px', fontSize: '14px', marginBottom: '10px' }} />
        <div style={{ display: 'flex', gap: '5px' }}>
          {['10', '50', '100'].map((val) => (
            <button key={val} onClick={() => setAmount(val)} style={{ flex: 1, padding: '8px', fontSize: '12px', backgroundColor: 'white', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer' }}>
              {val}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: 'white', borderRadius: '4px' }}>
        <div style={{ fontSize: '12px', color: '#666' }}>
          {side === 'sell' ? (
            <>
              <div>Collateral locked: {parseFloat(amount).toFixed(2)} USDC</div>
              <div>Payment received: ~{(parseFloat(price) * parseFloat(amount)).toFixed(2)} USDC</div>
              <div>Net cost: ~{((1 - parseFloat(price)) * parseFloat(amount)).toFixed(2)} USDC</div>
              <div>You get: {parseFloat(amount).toFixed(0)} {outcome === 0 ? 'UP' : 'DOWN'} tokens (opposite)</div>
              <div>Max profit: ~{(parseFloat(price) * parseFloat(amount)).toFixed(2)} USDC (if your token wins)</div>
            </>
          ) : (
            <>
              <div>Cost: ~{(parseFloat(price) * parseFloat(amount)).toFixed(2)} USDC</div>
              <div>You get: {parseFloat(amount).toFixed(0)} {outcome === 0 ? 'DOWN' : 'UP'} tokens</div>
              <div>Max profit: ~{((1 - parseFloat(price)) * parseFloat(amount)).toFixed(2)} USDC (if wins)</div>
            </>
          )}
          <div style={{ marginTop: '5px' }}>Fee: 0.6% (0.3% maker + 0.3% taker)</div>
        </div>
      </div>

      <button onClick={handleSubmit} disabled={loading || !account} style={{ width: '100%', padding: '12px', fontSize: '16px', fontWeight: 'bold', backgroundColor: borderColor, color: 'white', border: 'none', borderRadius: '4px', cursor: loading || !account ? 'not-allowed' : 'pointer', opacity: loading || !account ? 0.6 : 1 }}>
        {loading ? 'Processing...' : !account ? 'Select Account First' : `${sideUpper} Order`}
      </button>

      {status && (
        <div style={{ marginTop: '15px', padding: '10px', backgroundColor: status.includes('Error') ? '#ffcdd2' : '#c8e6c9', color: status.includes('Error') ? '#c62828' : '#2e7d32', borderRadius: '4px', fontSize: '12px' }}>
          {status}
        </div>
      )}
    </div>
  );
}
