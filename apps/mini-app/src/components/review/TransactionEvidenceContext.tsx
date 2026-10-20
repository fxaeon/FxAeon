'use client';
import { createContext, useContext } from 'react';
/** Harnesses opt in explicitly. Production evidence and explorer links stay live by default. */
export const TransactionEvidenceContext = createContext<'live' | 'simulation'>('live');
export const useTransactionEvidence = () => useContext(TransactionEvidenceContext);
