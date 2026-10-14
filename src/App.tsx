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
import Record from './pages/Record';
import Saved from './pages/Saved';
import Diary from './pages/Diary';
import Routines from './pages/Routines';
import RoutineForm from './pages/RoutineForm';
import Crops from './pages/Crops';
import FarmTypes from './pages/FarmTypes';
import InvoiceForm from './pages/InvoiceForm';
import Bills from './pages/Bills';
import People from './pages/People';
import Changes from './pages/Changes';
import Join from './pages/Join';
import MovePhoneData from './pages/MovePhoneData';
import Calving from './pages/Calving';
import SeasonForm from './pages/SeasonForm';
import DryOff from './pages/DryOff';
import CalfForm from './pages/CalfForm';
import Fields from './pages/Fields';
import Fertiliser, { FertiliserDetail } from './pages/Fertiliser';
import FertiliserEdit from './pages/FertiliserEdit';
import FertiliserDelivery from './pages/FertiliserDelivery';
import SpreadForm from './pages/SpreadForm';

export default function App() {
  if (!supabaseConfigured) return <MissingConfig />;
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/onboarding" element={<Onboarding />} />
      <Route path="/join/:token" element={<Join />} />
      {/* Online build: copy the phone app's records into this account (works before a farm exists) */}
      <Route path="/move-phone-data" element={<MovePhoneData />} />
      <Route element={<RequireFarm />}>
        <Route index element={<Today />} />
        <Route path="forecast" element={<Forecast />} />
        <Route path="progress" element={<Forecast />} />
        <Route path="more" element={<FarmHub />} />
        <Route path="feed/new" element={<FeedEdit />} />
        <Route path="feed/:id" element={<FeedDetail />} />
        <Route path="feed/:id/edit" element={<FeedEdit />} />
        <Route path="feed/:id/count" element={<StockCount />} />
        <Route path="feed/:id/rule/new" element={<FeedingRuleForm />} />
        <Route path="feed/:id/rule/:ruleId" element={<FeedingRuleForm />} />
        <Route path="record" element={<Record />} />
        <Route path="record/done" element={<Saved />} />
        <Route path="record/delivery" element={<DeliveryForm />} />
        <Route path="record/order" element={<OrderForm />} />
        <Route path="record/count" element={<StockCount />} />
        <Route path="record/milk" element={<MilkSaleForm />} />
        <Route path="record/sale" element={<AnimalSaleForm />} />
        <Route path="record/cost" element={<CostForm />} />
        <Route path="record/income" element={<IncomeForm />} />
        <Route path="record/invoice" element={<InvoiceForm />} />
        <Route path="record/calf" element={<CalfForm />} />
        <Route path="record/spread" element={<SpreadForm />} />
        <Route path="record/fertiliser" element={<FertiliserDelivery />} />
        <Route path="fertiliser" element={<Fertiliser />} />
        <Route path="fertiliser/new" element={<FertiliserEdit />} />
        <Route path="fertiliser/:id" element={<FertiliserDetail />} />
        <Route path="fertiliser/:id/edit" element={<FertiliserEdit />} />
        <Route path="farm/fields" element={<Fields />} />
        <Route path="calving" element={<Calving />} />
        <Route path="calving/season/new" element={<SeasonForm />} />
        <Route path="calving/season/:id" element={<SeasonForm />} />
        <Route path="calving/dry-off" element={<DryOff />} />
        <Route path="money/bills" element={<Bills />} />
        <Route path="settings/people" element={<People />} />
        <Route path="settings/changes" element={<Changes />} />
        <Route path="money" element={<Money />} />
        <Route path="money/year-end" element={<YearEnd />} />
        <Route path="diary" element={<Diary />} />
        <Route path="routines" element={<Routines />} />
        <Route path="routines/new" element={<RoutineForm />} />
        <Route path="routines/:id" element={<RoutineForm />} />
        <Route path="money/budget" element={<Budget />} />
        <Route path="farm" element={<FarmHub />} />
        <Route path="farm/groups" element={<Groups />} />
        <Route path="farm/types" element={<FarmTypes />} />
        <Route path="farm/crops" element={<Crops />} />
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
        <li>Run <code className="rounded bg-card px-1">npm run supabase:start</code> (Docker must be running).</li>
        <li>Copy <code className="rounded bg-card px-1">.env.example</code> to <code className="rounded bg-card px-1">.env.local</code> and paste the anon key it printed.</li>
        <li>Restart <code className="rounded bg-card px-1">npm run dev</code>.</li>
      </ol>
    </div>
  );
}
