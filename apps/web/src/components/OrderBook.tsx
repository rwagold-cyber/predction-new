import { useState, useEffect } from 'react';
import { formatPrice } from '../lib/ethers';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

interface OrderBookOrder {
  price: string;
  amount: string;
  orderCount: number;
}

interface OrderBookData {
  bids: OrderBookOrder[];
  asks: OrderBookOrder[];
}

interface OrderBookProps {
  marketId: string;
  outcome: number;
}

export default function OrderBook({ marketId, outcome }: OrderBookProps) {
  const [orderBook, setOrderBook] = useState<OrderBookData>({ bids: [], asks: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadOrderBook();
    const interval = setInterval(loadOrderBook, 3000);
    return () => clearInterval(interval);
  }, [marketId, outcome]);

  const loadOrderBook = async () => {
    try {
      const response = await fetch(`${API_URL}/api/v1/orderbook/${marketId}/${outcome}`);
      const data = await response.json();
      if (data.bids && data.asks) {
        setOrderBook(data);
      } else {
        setOrderBook({ bids: [], asks: [] });
      }
    } catch (error) {
      console.error('Failed to load order book:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatAmount = (amount: string): string => {
    const num = parseFloat(amount) / 1e6; // USDC has 6 decimals
    return num.toFixed(2);
  };

  return (
    <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <h3 style={{ margin: 0 }}>
          Order Book - {outcome === 1 ? 'UP' : 'DOWN'}
        </h3>
        <button onClick={loadOrderBook} style={{ padding: '5px 10px', fontSize: '12px' }}>
          Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '20px' }}>Loading...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          {/* Asks (Sell Orders) */}
          <div>
            <h4 style={{ margin: '0 0 10px 0', color: '#f44336' }}>Asks (Sell)</h4>
            {orderBook.asks.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#999', padding: '20px' }}>No asks</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#ffebee' }}>
                    <th style={{ padding: '8px', textAlign: 'left' }}>Price</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>Amount</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {orderBook.asks.map((ask, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '8px', color: '#f44336', fontWeight: 'bold' }}>
                        {formatPrice(ask.price)}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        {formatAmount(ask.amount)}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', color: '#999' }}>
                        {ask.orderCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Bids (Buy Orders) */}
          <div>
            <h4 style={{ margin: '0 0 10px 0', color: '#4CAF50' }}>Bids (Buy)</h4>
            {orderBook.bids.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#999', padding: '20px' }}>No bids</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                <thead>
                  <tr style={{ backgroundColor: '#e8f5e9' }}>
                    <th style={{ padding: '8px', textAlign: 'left' }}>Price</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>Amount</th>
                    <th style={{ padding: '8px', textAlign: 'right' }}>Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {orderBook.bids.map((bid, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '8px', color: '#4CAF50', fontWeight: 'bold' }}>
                        {formatPrice(bid.price)}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        {formatAmount(bid.amount)}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', color: '#999' }}>
                        {bid.orderCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
