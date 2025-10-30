import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import {
  createWallet,
  getUSDCContract,
  getSettlementContract,
  formatUSDC,
  parseUSDC,
} from '../lib/ethers';
import { USDC_ADDRESS, SETTLEMENT_ADDRESS } from '../lib/contracts';

interface AccountPanelProps {
  selectedAccount: { label: string; address: string; privateKey: string } | null;
  onAccountChange: (account: { label: string; address: string; privateKey: string }) => void;
}

const DEMO_ACCOUNTS = [
  {
    label: 'Demo Trader',
    address: import.meta.env.VITE_DEMO_TRADER_ADDRESS,
    privateKey: import.meta.env.VITE_DEMO_TRADER_PK,
  },
  {
    label: 'Liquidity Provider',
    address: import.meta.env.VITE_LIQUIDITY_PROVIDER_ADDRESS,
    privateKey: import.meta.env.VITE_LIQUIDITY_PROVIDER_PK,
  },
].filter((acc) => acc.address && acc.privateKey);

export default function AccountPanel({ selectedAccount, onAccountChange }: AccountPanelProps) {
  const [usdcBalance, setUsdcBalance] = useState('0');
  const [collateralBalance, setCollateralBalance] = useState('0');
  const [depositAmount, setDepositAmount] = useState('50');
  const [withdrawAmount, setWithdrawAmount] = useState('10');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  // Load balances
  useEffect(() => {
    if (selectedAccount) {
      loadBalances();
      const interval = setInterval(loadBalances, 5000);
      return () => clearInterval(interval);
    }
  }, [selectedAccount]);

  const loadBalances = async () => {
    if (!selectedAccount) return;

    try {
      const wallet = createWallet(selectedAccount.privateKey);
      const usdc = getUSDCContract(wallet);
      const settlement = getSettlementContract(wallet);

      const [usdcBal, collBal] = await Promise.all([
        usdc.balanceOf(selectedAccount.address),
        settlement.collateralBalances(selectedAccount.address, USDC_ADDRESS),
      ]);

      setUsdcBalance(formatUSDC(usdcBal));
      setCollateralBalance(formatUSDC(collBal));
    } catch (error) {
      console.error('Failed to load balances:', error);
    }
  };

  const handleDeposit = async () => {
    if (!selectedAccount || !depositAmount) return;

    setLoading(true);
    setStatus('Approving USDC...');

    try {
      const wallet = createWallet(selectedAccount.privateKey);
      const usdc = getUSDCContract(wallet);
      const settlement = getSettlementContract(wallet);

      const amount = parseUSDC(depositAmount);

      // Check allowance
      const allowance = await usdc.allowance(selectedAccount.address, SETTLEMENT_ADDRESS);
      if (allowance < amount) {
        setStatus('Approving USDC...');
        const approveTx = await usdc.approve(SETTLEMENT_ADDRESS, amount);
        await approveTx.wait();
      }

      // Deposit
      setStatus('Depositing collateral...');
      const depositTx = await settlement.depositCollateral(USDC_ADDRESS, amount);
      await depositTx.wait();

      setStatus(`Successfully deposited ${depositAmount} USDC!`);
      await loadBalances();
      setTimeout(() => setStatus(''), 3000);
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
      console.error('Deposit failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!selectedAccount || !withdrawAmount) return;

    setLoading(true);
    setStatus('Withdrawing collateral...');

    try {
      const wallet = createWallet(selectedAccount.privateKey);
      const settlement = getSettlementContract(wallet);

      const amount = parseUSDC(withdrawAmount);

      const withdrawTx = await settlement.withdrawCollateral(USDC_ADDRESS, amount);
      await withdrawTx.wait();

      setStatus(`Successfully withdrew ${withdrawAmount} USDC!`);
      await loadBalances();
      setTimeout(() => setStatus(''), 3000);
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
      console.error('Withdraw failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
      <h2 style={{ marginTop: 0 }}>Account Panel</h2>

      <div style={{ marginBottom: '20px' }}>
        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
          Select Account:
        </label>
        <select
          value={selectedAccount?.address || ''}
          onChange={(e) => {
            const acc = DEMO_ACCOUNTS.find((a) => a.address === e.target.value);
            if (acc) onAccountChange(acc);
          }}
          style={{ width: '100%', padding: '8px', fontSize: '14px' }}
        >
          <option value="">-- Select --</option>
          {DEMO_ACCOUNTS.map((acc) => (
            <option key={acc.address} value={acc.address}>
              {acc.label}
            </option>
          ))}
        </select>
      </div>

      {selectedAccount && (
        <>
          <div style={{ marginBottom: '15px', fontSize: '14px' }}>
            <div style={{ fontWeight: 'bold' }}>Address:</div>
            <div style={{ fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all' }}>
              {selectedAccount.address}
            </div>
          </div>

          <div style={{ marginBottom: '15px', padding: '10px', backgroundColor: 'white', borderRadius: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span>USDC Balance:</span>
              <span style={{ fontWeight: 'bold' }}>{usdcBalance} USDC</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Collateral Balance:</span>
              <span style={{ fontWeight: 'bold', color: 'green' }}>{collateralBalance} USDC</span>
            </div>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
              Deposit Amount (USDC):
            </label>
            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                style={{ flex: 1, padding: '8px' }}
              />
              <button onClick={() => setDepositAmount('50')} style={{ padding: '8px 12px' }}>
                50
              </button>
              <button onClick={() => setDepositAmount('100')} style={{ padding: '8px 12px' }}>
                100
              </button>
            </div>
            <button
              onClick={handleDeposit}
              disabled={loading}
              style={{
                width: '100%',
                marginTop: '10px',
                padding: '10px',
                backgroundColor: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: 'bold',
              }}
            >
              {loading ? 'Processing...' : 'Deposit'}
            </button>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
              Withdraw Amount (USDC):
            </label>
            <input
              type="number"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              style={{ width: '100%', padding: '8px', marginBottom: '10px' }}
            />
            <button
              onClick={handleWithdraw}
              disabled={loading}
              style={{
                width: '100%',
                padding: '10px',
                backgroundColor: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '14px',
                fontWeight: 'bold',
              }}
            >
              {loading ? 'Processing...' : 'Withdraw'}
            </button>
          </div>

          {status && (
            <div
              style={{
                padding: '10px',
                backgroundColor: status.includes('Error') ? '#ffebee' : '#e8f5e9',
                color: status.includes('Error') ? '#c62828' : '#2e7d32',
                borderRadius: '4px',
                fontSize: '12px',
              }}
            >
              {status}
            </div>
          )}
        </>
      )}
    </div>
  );
}
