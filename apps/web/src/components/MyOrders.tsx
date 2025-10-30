import { useState, useEffect } from 'react';
import { formatPrice } from '../lib/ethers';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

interface LocalOrder {
  orderId: string;
  marketId: string;
  outcome: number;
  side: 'buy' | 'sell';
  pricePips: string;
  amount: string;
  timestamp: number;
}

interface MyOrdersProps {
  orders: LocalOrder[];
  onRemoveOrder: (orderId: string) => void;
}

export default function MyOrders({ orders, onRemoveOrder }: MyOrdersProps) {
  const [orderStatuses, setOrderStatuses] = useState<Record<string, any>>({});
  const [cancelling, setCancelling] = useState<string | null>(null);

  useEffect(() => {
    if (orders.length > 0) {
      loadOrderStatuses();
      const interval = setInterval(loadOrderStatuses, 5000);
      return () => clearInterval(interval);
    }
  }, [orders]);

  const loadOrderStatuses = async () => {
    const statuses: Record<string, any> = {};
    await Promise.all(
      orders.map(async (order) => {
        try {
          const response = await fetch(`${API_URL}/api/v1/orders/${order.orderId}`);
          const data = await response.json();
          statuses[order.orderId] = data;
        } catch (error) {
          console.error(`Failed to load status for ${order.orderId}:`, error);
        }
      })
    );
    setOrderStatuses(statuses);
  };

  const handleCancel = async (order: LocalOrder) => {
    setCancelling(order.orderId);
    try {
      const response = await fetch(
        `${API_URL}/api/v1/orders/${order.orderId}?marketId=${order.marketId}&outcome=${order.outcome}`,
        { method: 'DELETE' }
      );
      const data = await response.json();
      if (data.success) {
        alert('Order cancelled successfully');
        onRemoveOrder(order.orderId);
      } else {
        alert(`Failed to cancel: ${data.error}`);
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    } finally {
      setCancelling(null);
    }
  };

  const formatAmount = (amount: string): string => {
    const num = parseFloat(amount) / 1e6;
    return num.toFixed(2);
  };

  return (
    <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
      <h3 style={{ marginTop: 0 }}>My Orders</h3>

      {orders.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#999', padding: '20px' }}>No orders yet. Place an order to get started.</div>
      ) : (
        <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
          {orders.map((order) => {
            const status = orderStatuses[order.orderId];
            const statusText = status?.status || 'unknown';
            const filled = status?.filledAmount || '0';
            const remaining = status?.remainingAmount || order.amount;

            return (
              <div key={order.orderId} style={{ padding: '15px', marginBottom: '10px', backgroundColor: 'white', border: '1px solid #ddd', borderRadius: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div>
                    <span style={{ fontWeight: 'bold', color: order.side === 'buy' ? '#4CAF50' : '#f44336' }}>
                      {order.side.toUpperCase()}
                    </span>
                    {' '}Market #{order.marketId} - {order.outcome === 1 ? 'UP' : 'DOWN'}
                  </div>
                  <div style={{ fontSize: '12px', padding: '2px 8px', borderRadius: '4px', backgroundColor: statusText === 'active' ? '#4CAF50' : statusText === 'filled' ? '#9E9E9E' : '#FF9800', color: 'white' }}>
                    {statusText.toUpperCase()}
                  </div>
                </div>

                <div style={{ fontSize: '14px', marginBottom: '8px' }}>
                  <div>Price: {formatPrice(order.pricePips)}</div>
                  <div>Amount: {formatAmount(order.amount)} USDC</div>
                  {filled !== '0' && <div>Filled: {formatAmount(filled)} USDC</div>}
                  {remaining !== order.amount && <div>Remaining: {formatAmount(remaining)} USDC</div>}
                </div>

                <div style={{ fontSize: '12px', color: '#999', marginBottom: '10px' }}>
                  Order ID: {order.orderId}
                  <br />
                  Time: {new Date(order.timestamp).toLocaleString()}
                </div>

                {statusText === 'active' && (
                  <button onClick={() => handleCancel(order)} disabled={cancelling === order.orderId} style={{ padding: '8px 16px', fontSize: '12px', backgroundColor: '#f44336', color: 'white', border: 'none', borderRadius: '4px', cursor: cancelling === order.orderId ? 'not-allowed' : 'pointer' }}>
                    {cancelling === order.orderId ? 'Cancelling...' : 'Cancel Order'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
