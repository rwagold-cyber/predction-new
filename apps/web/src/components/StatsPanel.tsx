import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

export default function StatsPanel() {
  const [stats, setStats] = useState<any>(null);
  const [marketStats, setMarketStats] = useState<any>(null);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadStats = async () => {
    try {
      const [statsResponse, marketStatsResponse] = await Promise.all([
        fetch(`${API_URL}/api/v1/stats`),
        fetch(`${API_URL}/api/v1/markets/stats/summary`),
      ]);

      const statsData = await statsResponse.json();
      const marketStatsData = await marketStatsResponse.json();

      setStats(statsData);
      if (marketStatsData.success) {
        setMarketStats(marketStatsData.stats);
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  return (
    <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
        <h3 style={{ margin: 0 }}>System Statistics</h3>
        <button onClick={loadStats} style={{ padding: '5px 10px', fontSize: '12px' }}>
          Refresh
        </button>
      </div>

      {!stats || !marketStats ? (
        <div style={{ textAlign: 'center', padding: '20px' }}>Loading...</div>
      ) : (
        <div>
          <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: 'white', borderRadius: '8px' }}>
            <h4 style={{ margin: '0 0 10px 0', color: '#2196F3' }}>Matching Engine</h4>
            <div style={{ fontSize: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                <span>Total Orders:</span>
                <span style={{ fontWeight: 'bold' }}>{stats.totalOrders || 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                <span>Active Order Books:</span>
                <span style={{ fontWeight: 'bold' }}>{stats.activeBooks || 0}</span>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: 'white', borderRadius: '8px' }}>
            <h4 style={{ margin: '0 0 10px 0', color: '#4CAF50' }}>Market Manager</h4>
            <div style={{ fontSize: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                <span>Total Markets:</span>
                <span style={{ fontWeight: 'bold' }}>{marketStats.totalMarketsTracked || 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                <span>Active Markets:</span>
                <span style={{ fontWeight: 'bold', color: '#4CAF50' }}>{marketStats.totalMarketsActive || 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                <span>Unresolved:</span>
                <span style={{ fontWeight: 'bold', color: '#FF9800' }}>{marketStats.unresolvedMarkets || 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                <span>Resolved:</span>
                <span style={{ fontWeight: 'bold', color: '#9E9E9E' }}>{marketStats.marketsResolved || 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                <span>Discoveries:</span>
                <span style={{ fontWeight: 'bold' }}>{marketStats.marketDiscoveries || 0}</span>
              </div>
            </div>
          </div>

          <div style={{ padding: '10px', backgroundColor: '#e3f2fd', borderRadius: '8px', fontSize: '12px', color: '#1976d2' }}>
            Last updated: {new Date().toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}
