import { useState } from 'react';
import AccountPanel from './components/AccountPanel';
import MarketList from './components/MarketList';
import OrderBook from './components/OrderBook';
import TradeForm from './components/TradeForm';
import MyOrders from './components/MyOrders';
import MarketCreator from './components/MarketCreator';
import StatsPanel from './components/StatsPanel';
import PositionPanel from './components/PositionPanel';
import RedemptionPanel from './components/RedemptionPanel';

interface Market {
  id: string;
  conditionId: string;
  startTime: number;
  endTime: number;
  resolved: boolean;
  winningOutcome: number | null;
  collateral: string;
  oracle: string;
  kind: number;
  timeframe: number;
}

interface LocalOrder {
  orderId: string;
  marketId: string;
  outcome: number;
  side: 'buy' | 'sell';
  pricePips: string;
  amount: string;
  timestamp: number;
}

function App() {
  const [selectedAccount, setSelectedAccount] = useState<{ label: string; address: string; privateKey: string } | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [selectedOutcome, setSelectedOutcome] = useState<number>(1);
  const [myOrders, setMyOrders] = useState<LocalOrder[]>([]);

  const handleOrderSubmitted = (orderId: string) => {
    // This callback receives orderId from TradeForm
    // We don't store full order details in LocalOrder anymore
    console.log('Order submitted:', orderId);
  };

  const handleRemoveOrder = (orderId: string) => {
    setMyOrders(myOrders.filter((o) => o.orderId !== orderId));
  };

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', backgroundColor: '#f5f5f5', minHeight: '100vh', padding: '20px' }}>
      <header style={{ backgroundColor: '#2196F3', color: 'white', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
        <h1 style={{ margin: 0, fontSize: '32px' }}>PredictX - BTC Prediction Market MVP</h1>
        <p style={{ margin: '5px 0 0 0', opacity: 0.9 }}>
          Trade on BTC price movements | Testnet Only
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr 350px', gap: '20px', marginBottom: '20px' }}>
        <div>
          <AccountPanel selectedAccount={selectedAccount} onAccountChange={setSelectedAccount} />
          <div style={{ marginTop: '20px' }}>
            <MarketCreator />
          </div>
        </div>

        <div>
          <MarketList selectedMarket={selectedMarket} onSelectMarket={setSelectedMarket} />

          {selectedMarket && (
            <div style={{ marginTop: '20px' }}>
              <div style={{ marginBottom: '15px', textAlign: 'center' }}>
                <div style={{ display: 'inline-flex', borderRadius: '8px', overflow: 'hidden', border: '1px solid #ddd' }}>
                  <button
                    onClick={() => setSelectedOutcome(0)}
                    style={{
                      padding: '12px 24px',
                      fontSize: '16px',
                      fontWeight: 'bold',
                      backgroundColor: selectedOutcome === 0 ? '#f44336' : 'white',
                      color: selectedOutcome === 0 ? 'white' : '#f44336',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    DOWN
                  </button>
                  <button
                    onClick={() => setSelectedOutcome(1)}
                    style={{
                      padding: '12px 24px',
                      fontSize: '16px',
                      fontWeight: 'bold',
                      backgroundColor: selectedOutcome === 1 ? '#4CAF50' : 'white',
                      color: selectedOutcome === 1 ? 'white' : '#4CAF50',
                      border: 'none',
                      borderLeft: '1px solid #ddd',
                      cursor: 'pointer',
                    }}
                  >
                    UP
                  </button>
                </div>
              </div>

              <OrderBook marketId={selectedMarket.id} outcome={selectedOutcome} />

              <div style={{ marginTop: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <TradeForm
                  market={selectedMarket}
                  account={selectedAccount}
                  outcome={selectedOutcome}
                  side="buy"
                  onOrderSubmitted={handleOrderSubmitted}
                />
                <TradeForm
                  market={selectedMarket}
                  account={selectedAccount}
                  outcome={selectedOutcome}
                  side="sell"
                  onOrderSubmitted={handleOrderSubmitted}
                />
              </div>
            </div>
          )}
        </div>

        <div>
          <StatsPanel />
          <div style={{ marginTop: '20px' }}>
            <RedemptionPanel account={selectedAccount} />
          </div>
          <div style={{ marginTop: '20px' }}>
            <PositionPanel account={selectedAccount} />
          </div>
          <div style={{ marginTop: '20px' }}>
            <MyOrders orders={myOrders} onRemoveOrder={handleRemoveOrder} />
          </div>
        </div>
      </div>

      <footer style={{ textAlign: 'center', color: '#999', fontSize: '12px', marginTop: '40px' }}>
        PredictX MVP | Socrates Testnet | For Testing Only
      </footer>
    </div>
  );
}

export default App;
