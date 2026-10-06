import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireFarm } from './components/Layout';
import { supabaseConfigured } from './lib/supabase';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import Today from './pages/Today';
import Forecast from './pages/Forecast';
import FeedDetail from './pages/FeedDetail';
import FeedEdit from './pages/FeedEdit';
import FeedingRuleForm from './pages/FeedingRuleForm';
import StockCount from './pages/StockCount';
import DeliveryForm from './pages/DeliveryForm';
import OrderForm from './pages/OrderForm';
import MilkSaleForm from './pages/MilkSaleForm';
import AnimalSaleForm from './pages/AnimalSaleForm';
import CostForm from './pages/CostForm';
import IncomeForm from './pages/IncomeForm';
import Money from './pages/Money';
import YearEnd from './pages/YearEnd';
import Budget from './pages/Budget';
import FarmHub from './pages/FarmHub';
import Groups from './pages/Groups';
import Silage from './pages/Silage';
import SilageForm from './pages/SilageForm';
import Suppliers from './pages/Suppliers';
import SupplierDetail from './pages/SupplierDetail';
import Records from './pages/Records';
import RecordForm from './pages/RecordForm';
import Jobs from './pages/Jobs';
import Ask from './pages/Ask';
import Settings from './pages/Settings';

export default function App() {
  if (!supabaseConfigured) return <MissingConfig />;
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route element={<RequireFarm />}>
        <Route index element={<Today />} />
        <Route path="forecast" element={<Forecast />} />
        <Route path="feed/new" element={<FeedEdit />} />
        <Route path="feed/:id" element={<FeedDetail />} />
        <Route path="feed/:id/edit" element={<FeedEdit />} />
        <Route path="feed/:id/count" element={<StockCount />} />
        <Route path="feed/:id/rule/new" element={<FeedingRuleForm />} />
        <Route path="feed/:id/rule/:ruleId" element={<FeedingRuleForm />} />
        <Route path="record/delivery" element={<DeliveryForm />} />
        <Route path="record/order" element={<OrderForm />} />
        <Route path="record/count" element={<StockCount />} />
        <Route path="record/milk" element={<MilkSaleForm />} />
        <Route path="record/sale" element={<AnimalSaleForm />} />
        <Route path="record/cost" element={<CostForm />} />
        <Route path="record/income" element={<IncomeForm />} />
        <Route path="money" element={<Money />} />
        <Route path="money/year-end" element={<YearEnd />} />
        <Route path="money/budget" element={<Budget />} />
        <Route path="farm" element={<FarmHub />} />
        <Route path="farm/groups" element={<Groups />} />
        <Route path="farm/silage" element={<Silage />} />
        <Route path="farm/silage/new" element={<SilageForm />} />
        <Route path="farm/silage/:id/edit" element={<SilageForm />} />
        <Route path="farm/jobs" element={<Jobs />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="suppliers/:id" element={<SupplierDetail />} />
        <Route path="records" element={<Records />} />
        <Route path="records/new" element={<RecordForm />} />
        <Route path="ask" element={<Ask />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function MissingConfig() {
  return (
    <div className="mx-auto max-w-lg space-y-3 p-6">
      <h1 className="h-display text-4xl">Connect Supabase</h1>
      <p>Agri-It needs a Supabase project. For local testing:</p>
      <ol className="list-decimal space-y-1 pl-6">
        <li>Run <code className="rounded bg-white px-1">npm run supabase:start</code> (Docker must be running).</li>
        <li>Copy <code className="rounded bg-white px-1">.env.example</code> to <code className="rounded bg-white px-1">.env.local</code> and paste the anon key it printed.</li>
        <li>Restart <code className="rounded bg-white px-1">npm run dev</code>.</li>
      </ol>
    </div>
  );
}
