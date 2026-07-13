import { useParams } from 'react-router-dom'
import { PageHeader } from '@/components/ui'
import NetWorthTab from './reports/NetWorthTab'
import CashFlowTab from './reports/CashFlowTab'
import SpendingTab from './reports/SpendingTab'
import EmergencyFundTab from './reports/EmergencyFundTab'
import SubscriptionsTab from './reports/SubscriptionsTab'

type ReportTab = 'spending' | 'net-worth' | 'cash-flow' | 'emergency-fund' | 'subscriptions'

const REPORT_TITLES: Record<ReportTab, string> = {
  'net-worth': 'Net Worth & Equity',
  'cash-flow': 'Cash Flow',
  'spending': 'Spending',
  'emergency-fund': 'Emergency Fund',
  'subscriptions': 'Subscriptions',
}

export default function ReportsPage() {
  const { reportTab } = useParams<{ reportTab: string }>()
  const activeTab = (reportTab ?? 'net-worth') as ReportTab
  const title = REPORT_TITLES[activeTab] ?? REPORT_TITLES['net-worth']

  return (
    <div className="space-y-6 animate-slide-up">
      <PageHeader title={title} />
      {/* Each tab is its own component, so only the active tab's report
          queries mount — switching tabs is what triggers the fetch, not
          loading the page. */}
      {activeTab === 'net-worth' && <NetWorthTab />}
      {activeTab === 'cash-flow' && <CashFlowTab />}
      {activeTab === 'spending' && <SpendingTab />}
      {activeTab === 'emergency-fund' && <EmergencyFundTab />}
      {activeTab === 'subscriptions' && <SubscriptionsTab />}
    </div>
  )
}
