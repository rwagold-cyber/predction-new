import { useState, useEffect } from 'react'
import { ethers } from 'ethers'

const API_URL = 'http://localhost:8080'
const RPC_URL = 'https://rpc-testnet.socrateschain.org'
const CHAIN_ID = 1111111

interface Market {
  marketId: string
  timeframe: number
  startTime: number
  endTime: number
  status: string
}

interface Order {
  id: string
  side: 'BUY' | 'SELL'
  price: number
  amount: number
}

function App() {
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null)
  const [account, setAccount] = useState<string>('')
  const [markets, setMarkets] = useState<Market[]>([])
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null)
  const [orderBook, setOrderBook] = useState<{ bids: Order[]; asks: Order[] }>({ bids: [], asks: [] })

  useEffect(() => {
    loadMarkets()
    const interval = setInterval(loadMarkets, 5000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (selectedMarket) {
      loadOrderBook(selectedMarket, 1)
    }
  }, [selectedMarket])

  const loadMarkets = async () => {
    try {
      const response = await fetch(`${API_URL}/api/markets`)
      const data = await response.json()
      setMarkets(data.markets)
    } catch (error) {
      console.error('Failed to load markets:', error)
    }
  }

  const loadOrderBook = async (marketId: string, outcome: number) => {
    try {
      const response = await fetch(`${API_URL}/api/orderbook/${marketId}/${outcome}`)
      const data = await response.json()
      setOrderBook(data)
    } catch (error) {
      console.error('Failed to load order book:', error)
    }
  }

  const connectWallet = async () => {
    if (typeof window.ethereum !== 'undefined') {
      try {
        const browserProvider = new ethers.BrowserProvider(window.ethereum)
        await browserProvider.send('eth_requestAccounts', [])

        // Check network
        const network = await browserProvider.getNetwork()
        if (network.chainId !== BigInt(CHAIN_ID)) {
          try {
            await window.ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: `0x${CHAIN_ID.toString(16)}` }],
            })
          } catch (error: any) {
            if (error.code === 4902) {
              await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [{
                  chainId: `0x${CHAIN_ID.toString(16)}`,
                  chainName: 'Socrates Testnet',
                  rpcUrls: [RPC_URL],
                }],
              })
            }
          }
        }

        const signer = await browserProvider.getSigner()
        const address = await signer.getAddress()
        setProvider(browserProvider)
        setAccount(address)
      } catch (error) {
        console.error('Failed to connect wallet:', error)
      }
    } else {
      alert('Please install MetaMask!')
    }
  }

  const submitOrder = async (side: 'BUY' | 'SELL', price: number, amount: number) => {
    if (!selectedMarket) return

    try {
      const response = await fetch(`${API_URL}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketId: selectedMarket,
          outcome: 1,
          side,
          price,
          amount,
          maker: account,
        }),
      })

      const data = await response.json()
      alert(`Order ${data.orderId} submitted!`)
      loadOrderBook(selectedMarket, 1)
    } catch (error) {
      console.error('Failed to submit order:', error)
    }
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif' }}>
      <h1>🎯 PredictX - BTC Price Prediction Market</h1>

      <div style={{ marginBottom: '20px' }}>
        {account ? (
          <div>Connected: {account.slice(0, 6)}...{account.slice(-4)}</div>
        ) : (
          <button onClick={connectWallet} style={{ padding: '10px 20px', fontSize: '16px' }}>
            Connect Wallet
          </button>
        )}
      </div>

      <h2>Markets</h2>
      <div style={{ display: 'grid', gap: '10px', marginBottom: '30px' }}>
        {markets.map(market => (
          <div
            key={market.marketId}
            onClick={() => setSelectedMarket(market.marketId)}
            style={{
              padding: '15px',
              border: selectedMarket === market.marketId ? '2px solid blue' : '1px solid #ccc',
              borderRadius: '8px',
              cursor: 'pointer',
              backgroundColor: selectedMarket === market.marketId ? '#f0f8ff' : 'white'
            }}
          >
            <div style={{ fontWeight: 'bold' }}>Market #{market.marketId} - {market.timeframe}m</div>
            <div>Status: <span style={{
              color: market.status === 'active' ? 'green' : market.status === 'pending' ? 'orange' : 'gray'
            }}>{market.status}</span></div>
            <div style={{ fontSize: '12px', color: '#666' }}>
              Start: {new Date(market.startTime * 1000).toLocaleString()}
            </div>
            <div style={{ fontSize: '12px', color: '#666' }}>
              End: {new Date(market.endTime * 1000).toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {selectedMarket && (
        <>
          <h2>Order Book - Market #{selectedMarket} (UP Outcome)</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '30px' }}>
            <div>
              <h3 style={{ color: 'green' }}>Bids (Buy)</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #ddd' }}>Price</th>
                    <th style={{ textAlign: 'right', padding: '8px', borderBottom: '1px solid #ddd' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {orderBook.bids.map(order => (
                    <tr key={order.id}>
                      <td style={{ padding: '8px', color: 'green' }}>${order.price}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{order.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <h3 style={{ color: 'red' }}>Asks (Sell)</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid #ddd' }}>Price</th>
                    <th style={{ textAlign: 'right', padding: '8px', borderBottom: '1px solid #ddd' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {orderBook.asks.map(order => (
                    <tr key={order.id}>
                      <td style={{ padding: '8px', color: 'red' }}>${order.price}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{order.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <h2>Place Order</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <OrderForm side="BUY" onSubmit={submitOrder} />
            <OrderForm side="SELL" onSubmit={submitOrder} />
          </div>
        </>
      )}
    </div>
  )
}

function OrderForm({ side, onSubmit }: { side: 'BUY' | 'SELL'; onSubmit: (side: 'BUY' | 'SELL', price: number, amount: number) => void }) {
  const [price, setPrice] = useState('0.5')
  const [amount, setAmount] = useState('100')

  return (
    <div style={{
      padding: '20px',
      border: `2px solid ${side === 'BUY' ? 'green' : 'red'}`,
      borderRadius: '8px'
    }}>
      <h3 style={{ color: side === 'BUY' ? 'green' : 'red' }}>{side}</h3>
      <div style={{ marginBottom: '10px' }}>
        <label>Price: </label>
        <input
          type="number"
          value={price}
          onChange={e => setPrice(e.target.value)}
          step="0.01"
          style={{ width: '100%', padding: '8px', marginTop: '5px' }}
        />
      </div>
      <div style={{ marginBottom: '10px' }}>
        <label>Amount: </label>
        <input
          type="number"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          style={{ width: '100%', padding: '8px', marginTop: '5px' }}
        />
      </div>
      <button
        onClick={() => onSubmit(side, parseFloat(price), parseFloat(amount))}
        style={{
          width: '100%',
          padding: '12px',
          fontSize: '16px',
          backgroundColor: side === 'BUY' ? 'green' : 'red',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer'
        }}
      >
        Place {side} Order
      </button>
    </div>
  )
}

export default App
