// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library Errors {
    // CTF Errors
    error CTF_InvalidCondition();
    error CTF_InvalidOutcome();
    error CTF_InsufficientBalance();
    error CTF_TransferFailed();

    // Settlement Errors
    error Settlement_InvalidSignature();
    error Settlement_OrderExpired();
    error Settlement_OrderFilled();
    error Settlement_InvalidNonce();
    error Settlement_InsufficientAmount();
    error Settlement_Unauthorized();

    // Market Errors
    error Market_NotResolved();
    error Market_AlreadyResolved();
    error Market_InvalidOutcome();
    error Market_Expired();

    // Oracle Errors
    error Oracle_PriceNotAvailable();
    error Oracle_InvalidTimestamp();
    error Oracle_PriceStale();
}
