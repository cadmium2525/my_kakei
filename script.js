// ====================================================================
// I. グローバル設定とデータ構造
// ====================================================================

const APP_DATA_KEY = 'futureflow_app_data_v1';
const MAX_PREDICTION_MONTHS = 1200; // 100年 (30年制限を撤廃)

let appData = {
    accounts: [], // [{ id: string, name: string }]
    families: [], // [{ id: string, name: string, age: number, birthMonth: number (1-12) }]
    recurringExpenses: [], // [{ id: string, name: string, amount: number, intervalYears: number (1-5), startYM: string ('YYYY-MM') }]
    loans: [], // [{ id: string, name: string, monthlyAmount: number, startYM: string, endYM: string }]
    futureEvents: [], // [{ id: string, name: string, amount: number, familyId: string, targetAge: number, targetMonth: number (1-12) }]
    monthlyBalances: [], // [{ month: string ('YYYY-MM'), total: number, accounts: { accountId: number } }]
    settings: {
        predictionYears: 30, // 予測期間（年）
        // monthlyIncome / yearlyBonus は廃止し、familyIncomesに移行
        familyIncomes: {}, // { familyId: { monthly: number, bonus: number, retirementYM: string, severance: number, pension: number } }
        currentLivingCost: 250000, // 現在の生活費 (円/月) - インフレ計算の基準
        inflationRate: 1.0, // インフレ率（年%）
        investmentMonthly: 30000, // 毎月の積立額 (円)
        investmentYield: 4.0, // 運用利回り（年%）
        educationMode: 'public', // 教育プラン: 'public' (公立), 'private' (私立)
        childIndependenceAge: 22, // 子供の自立年齢
        costReductionRate: 20, // 子供自立後の生活費削減率 (%)
        licenseReturnAge: 75, // 免許返納年齢（車両費停止）
        univHousingType: 'home', // 大学時の居住: 'home' (自宅), 'away' (自宅外)
        univAllowance: 100000,   // 自宅外時の仕送り (月額)
        salaryIncreaseAmount: 0, // 毎年の定期昇給額 (月額・円)
    },
};

const RECURRING_INTERVALS = [1, 2, 3, 4, 5, 10, 15, 20];

let currentScreen = 'dashboard';
let currentSettingTab = 'family-account';
let simulationChart = null;

// ====================================================================
// II. データ永続化 (localStorage)
// ====================================================================

/**
 * データをlocalStorageからロードし、Chart.jsの設定と初期描画を行う。
 */
const loadData = () => {
    try {
        const storedData = localStorage.getItem(APP_DATA_KEY);
        if (storedData) {
            const parsedData = JSON.parse(storedData);
            // 既存のデータを上書き（デフォルト値を保持するためにスプレッド演算子を使用）
            appData = { ...appData, ...parsedData };
            // 互換性チェック（旧データ形式から新データ形式への移行ロジックが必要な場合はここに追加）
            console.log("データをロードしました:", appData);
        }
    } catch (error) {
        console.error("データのロード中にエラーが発生しました:", error);
        showMessage("データのロードエラー", "保存されたデータの形式に問題があるため、初期データで開始します。");
    }
};

/**
 * 現在のデータをlocalStorageに保存する。
 */
const saveData = () => {
    try {
        localStorage.setItem(APP_DATA_KEY, JSON.stringify(appData));
    } catch (error) {
        console.error("データの保存中にエラーが発生しました:", error);
        showMessage("データの保存エラー", "データの保存に失敗しました。ブラウザのストレージを確認してください。");
    }
};

/**
 * UUIDを生成する。
 * @returns {string} UUID
 */
const generateId = () => crypto.randomUUID();

// ====================================================================
// III. ユーティリティ関数
// ====================================================================

/**
 * カスタムメッセージボックスを表示する (alert/confirmの代替)。
 * @param {string} title - モーダルのタイトル
 * @param {string} message - 表示するメッセージ
 * @param {boolean} isConfirm - 確認ダイアログかどうか (キャンセルボタンの有無)
 * @returns {Promise<boolean>} OK/キャンセルがクリックされたかどうか
 */
const showMessage = (title, message, isConfirm = false) => {
    return new Promise(resolve => {
        const modal = document.getElementById('message-modal');
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-message').textContent = message;
        const okButton = document.getElementById('modal-ok');
        const cancelButton = document.getElementById('modal-cancel');

        cancelButton.classList.toggle('hidden', !isConfirm);

        okButton.onclick = () => {
            modal.classList.add('hidden');
            resolve(true);
        };

        if (isConfirm) {
            cancelButton.onclick = () => {
                modal.classList.add('hidden');
                resolve(false);
            };
        }

        modal.classList.remove('hidden');
    });
};

/**
 * 数値を日本円形式にフォーマットする。
 * @param {number} num - 金額
 * @returns {string} フォーマットされた文字列
 */
const formatCurrency = (num) => {
    if (num === null || num === undefined) return 'N/A';
    // NaN または Infinity の場合は 'N/A' を返すなどの対応を追加するとより堅牢になりますが、
    // 今回は Number() が返す NaN に対応するため、このまま Number.isNaN を使用
    if (Number.isNaN(num)) return 'N/A';
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(num);
};

/**
 * YYYY-MM形式の文字列からDateオブジェクトを作成する。
 * @param {string} ym - YYYY-MM形式の文字列
 * @returns {Date} Dateオブジェクト
 */
const parseYearMonth = (ym) => {
    const [year, month] = ym.split('-').map(Number);
    // 月は0から始まるため -1 する
    return new Date(year, month - 1, 1);
};

/**
 * DateオブジェクトからYYYY-MM形式の文字列を作成する。
 * @param {Date} date - Dateオブジェクト
 * @returns {string} YYYY-MM形式の文字列
 */
const formatDateToYM = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
};

/**
 * Dateオブジェクトの月を1ヶ月進める。
 * @param {Date} date - 変更するDateオブジェクト
 * @returns {Date} 1ヶ月進んだDateオブジェクト
 */
const addMonth = (date) => {
    const newDate = new Date(date);
    newDate.setMonth(newDate.getMonth() + 1);
    return newDate;
};

/**
 * 月数の差を計算する (date1 - date2)
 * @param {string} ym1 - YYYY-MM (新しい方)
 * @param {string} ym2 - YYYY-MM (古い方)
 * @returns {number} 月数の差
 */
const diffMonths = (ym1, ym2) => {
    const date1 = parseYearMonth(ym1);
    const date2 = parseYearMonth(ym2);
    return (date1.getFullYear() - date2.getFullYear()) * 12 + (date1.getMonth() - date2.getMonth());
}

/**
 * 特定の月に発生する定期支出の合計額を計算する。
 * @param {string} targetYM - YYYY-MM
 * @param {string} firstBalanceYM - 最初の実績残高の年月 (コア収支計算の開始点)
 * @returns {number} 支出合計額
 */
const getRecurringExpenseForMonth = (targetYM, firstBalanceYM) => {
    const [targetYear, targetMonthNum] = targetYM.split('-').map(Number);
    const targetDate = parseYearMonth(targetYM);
    const firstDate = parseYearMonth(firstBalanceYM);

    let expenseTotal = 0;

    appData.recurringExpenses.forEach(exp => {
        const startYM = exp.startYM;
        const intervalYears = exp.intervalYears;

        // 支払い開始年月より前ならスキップ
        if (targetYM.localeCompare(startYM) < 0) return;

        const startDate = parseYearMonth(startYM);
        const [startYear, startMonthNum] = startYM.split('-').map(Number);

        // 発生月が一致するかどうかチェック
        if (targetMonthNum === startMonthNum) {
            // 開始月から何年経過したか
            const yearsPassed = targetYear - startYear;

            if (yearsPassed % intervalYears === 0) {
                expenseTotal += exp.amount;
            }
        }
    });
    return expenseTotal;
}

// ====================================================================
// IV. シミュレーションロジック
// ====================================================================

/**
 * ロジック1: 過去の実績から「定常的な月間変化（コア収支）」を算出する。
 * @returns {number | null} 平均コア収支 (JPY/month) または null (データ不足)
 */
const calculateCoreMonthlyChange = () => {
    // このレガシー関数は calculateNormalizedCoreBalance に置き換えられますが、
    // 単純な平均を知りたい場合のために残すか、新しいロジックに統合します。
    // 現状はUI表示用に使われているため、新しいロジックの結果を返すラッパーにします。
    return calculateNormalizedCoreBalance();
};

/**
 * 履歴データから「基礎キャッシュフロー（固定費除去後）」を算出する。
 * (実績変化額 + その月に支払われた定期支出) の平均 = 何もしなくても生み出せる余力
 */
const calculateNormalizedCoreBalance = () => {
    const balances = [...appData.monthlyBalances].sort((a, b) => a.month.localeCompare(b.month));
    if (balances.length < 2) return null;

    const coreSurpluses = [];

    for (let i = 1; i < balances.length; i++) {
        const currentMonthYM = balances[i].month;
        const prevTotal = balances[i - 1].total;
        const currentTotal = balances[i].total;

        // 1. 実績の変化額
        let actualChange = currentTotal - prevTotal;

        // 2. その月に支払われた「定期支出」を足し戻す (住宅ローンなどが引かれているなら、足し戻して「基礎体力」を見る)
        let paidRecurring = getRecurringExpenseForMonth(currentMonthYM, balances[0].month);

        // 2-B. 支払われているローンの除去 (ローンがある状態で実績が出ているなら、ローンがない状態の実力値に戻す)
        let paidLoans = 0;
        if (appData.loans) {
            appData.loans.forEach(loan => {
                // startYM <= current <= endYM
                if (currentMonthYM >= loan.startYM && currentMonthYM <= loan.endYM) {
                    paidLoans += loan.monthlyAmount;
                }
            });
        }

        // 3. 将来イベントも同様に足し戻す
        let paidEvents = 0;
        const [currYear, currMonth] = currentMonthYM.split('-').map(Number);
        appData.futureEvents.forEach(evt => {
            const fam = appData.families.find(f => f.id === evt.familyId);
            if (fam) {
                const now = new Date();
                const eventYear = (now.getFullYear() - fam.age) + evt.targetAge;
                if (eventYear === currYear && evt.targetMonth === currMonth) {
                    paidEvents += evt.amount;
                }
            }
        });

        // 基礎余力 = 実際の手残り + 払った固定費 + 払ったイベント費 + 払ったローン
        coreSurpluses.push(actualChange + paidRecurring + paidEvents + paidLoans);
    }

    if (coreSurpluses.length === 0) return 0;
    const avg = coreSurpluses.reduce((a, b) => a + b, 0) / coreSurpluses.length;
    return Math.round(avg);
};

// 教育費概算 (月額) - 文部科学省「子供の学習費調査」などを参考に簡易化
const EDUCATION_COSTS = {
    // 月額換算 (塾・習い事などの学校外活動費含む概算)
    // 公立コース: 小中高公立・大学国公立
    // 私立コース: 小中高私立・大学私立 (理系・文系平均)
    // 参照: 文部科学省「子供の学習費調査(R3)」, 日本政策金融公庫「教育費負担の実態調査(R3)」
    public: {
        kindergarten: 25000,   // 3-5歳 (幼児教育無償化後も給食費・バス代等はかかる)
        elementary: 27000,     // 6-11歳 (学校教育費 + 学校外活動費)
        juniorHigh: 45000,     // 12-14歳 (塾費用が増加する)
        highSchool: 43000,     // 15-17歳 (公立高校授業料無償化所得制限ありだが、平均として計上)
        university: 90000      // 18-21歳 (国公立授業料 + 通学定期/教科書等)
    },
    private: {
        kindergarten: 45000,
        elementary: 140000,    // 私立小は高額
        juniorHigh: 120000,
        highSchool: 90000,
        university: 140000     // 私立大理系含む平均
    }
};

// 成長に伴う生活費追加（教育費以外：食費、通信費、被服費、小遣いなど）
// 現在の生活費に入っていると仮定し、そこからの増減を計算するために使用
const GROWTH_EXPENSES = {
    middleSchool: 10000, // 12-14歳: 食べ盛り、スマホ開始
    highSchool: 15000,   // 15-17歳: ピーク、交際費増
    college: 10000       // 18-22歳: 大人並みだがバイトもあるので少し減
};

const getGrowthExpense = (age) => {
    if (age >= 12 && age <= 14) return GROWTH_EXPENSES.middleSchool;
    if (age >= 15 && age <= 17) return GROWTH_EXPENSES.highSchool;
    if (age >= 18 && age <= 22) return GROWTH_EXPENSES.college; // ～22歳まで
    return 0;
};

const getEducationCost = (age, mode) => {
    // 簡易ロジック: 年齢で学校種別を判定
    // 3-5: 幼稚園, 6-11: 小学校, 12-14: 中学校, 15-17: 高校, 18-21: 大学

    // 高校まで公立・大学私立パターン
    if (mode === 'public_private_univ') {
        if (age >= 3 && age <= 5) return EDUCATION_COSTS.public.kindergarten;
        if (age >= 6 && age <= 11) return EDUCATION_COSTS.public.elementary;
        if (age >= 12 && age <= 14) return EDUCATION_COSTS.public.juniorHigh;
        if (age >= 15 && age <= 17) return EDUCATION_COSTS.public.highSchool;
        if (age >= 18 && age <= 21) return EDUCATION_COSTS.private.university;
        return 0;
    }

    const costs = EDUCATION_COSTS[mode];
    if (age >= 3 && age <= 5) return costs.kindergarten;
    if (age >= 6 && age <= 11) return costs.elementary;
    if (age >= 12 && age <= 14) return costs.juniorHigh;
    if (age >= 15 && age <= 17) return costs.highSchool;
    if (age >= 18 && age <= 21) return costs.university;
    return 0;
};

const runSimulation = (customSettings = null, customFamilies = null, customLoans = null, customRecurring = null) => {
    // 引数がなければグローバルデータを使用
    const s = customSettings || appData.settings;
    const fams = customFamilies || appData.families;
    const loans = customLoans || appData.loans;
    const recurring = customRecurring || appData.recurringExpenses;

    const balances = [...appData.monthlyBalances].sort((a, b) => a.month.localeCompare(b.month));
    const predictionYears = s.predictionYears;
    const maxMonths = Math.min(predictionYears * 12, MAX_PREDICTION_MONTHS);

    // 実績がない場合でもシミュレーションできるように、デフォルト値を設定
    // 実績があれば最新の残高をスタートにする
    let currentTotal = 0;
    let latestMonth = new Date().toISOString().slice(0, 7);

    if (balances.length > 0) {
        const latestBalance = balances[balances.length - 1];
        currentTotal = latestBalance.total;
        latestMonth = latestBalance.month;
    }

    let currentInvestment = 0; // 運用資産

    // 日付管理
    const startDate = addMonth(parseYearMonth(latestMonth));
    let currentMonthDate = startDate;
    let crashMonth = null;

    const result = {
        labels: [latestMonth],
        data: [currentTotal],     // 総資産 (現金 + 投資)
        investmentData: [0],      // 投資資産の内訳
    };

    // シミュレーション用家族年齢管理 (初期化)
    // Deep Copy to avoid mutating original objects during simulation
    const simFamilies = JSON.parse(JSON.stringify(fams));

    // ベース収支パラメータ
    const monthlyIncome = s.monthlyIncome || 0;
    const monthlyBonus = (s.yearlyBonus || 0) / 12; // 平準化して加算

    // 初期生活費 (インフレ前)
    // ★修正: ユーザー入力値(s.currentLivingCost)は「現在の子供の状態」を含んでいる。
    // そのため、「子供の成長コスト」を変動させるには、まず「子供コスト抜きのベース生活費」を逆算する必要がある。
    // Base = Input - InitialGrowthCost
    // Monthly = Base * Inf + CurrentGrowthCost * Inf

    let initialGrowthCostSum = 0;
    simFamilies.forEach(f => {
        // 本人以外(simFamilies[0]除く) かつ 子供年齢
        // ※simFamilies[0]は世帯主(親)と仮定
        if (f !== simFamilies[0] && f.age <= s.childIndependenceAge) {
            initialGrowthCostSum += getGrowthExpense(f.age);
        }
    });

    // ベース生活費（大人だけの生活費 + 固定的な家計費）
    // もしマイナスになる（入力が少なすぎる）場合は最低0にする
    const baseLivingCost = Math.max(0, (s.currentLivingCost || 250000) - initialGrowthCostSum);

    // 内訳集計用変数 (生涯累計)
    let totalLivingCost = 0;
    let totalEduCost = 0;
    let totalLoanCost = 0;
    let totalRecurringCost = 0;
    let totalInvestCost = 0;

    for (let i = 0; i < maxMonths; i++) {
        const currentMonthYM = formatDateToYM(currentMonthDate);
        const currentYearNum = currentMonthDate.getFullYear();
        const currentMonthNum = currentMonthDate.getMonth() + 1;

        // 経過年数
        const yearsPassed = Math.floor(i / 12);

        // ★インフレ率計算をここに移動 (収入にも適用するため)
        const inflationFactor = Math.pow(1 + s.inflationRate / 100, yearsPassed);

        // A. 収入の加算 (家族ごと)
        let monthlyIncomeTotal = 0;
        const familyIncomes = s.familyIncomes || {};

        appData.families.forEach(f => {
            // 本人のシミュレーション年齢は simFamilies[index].age だが、
            // incomeデータのキーは f.id。
            // 退職判定は「年月」で行うため、年齢計算は補足的。

            const inc = familyIncomes[f.id];
            if (!inc) return;

            // 退職チェック (年齢ベース)
            // 年齢は1月に加算される。現在の年齢 >= 退職年齢 なら退職済みとみなす。
            // 退職の瞬間(justRetired)は「年齢がRetireAgeになった年の1月」とする簡易ロジック

            let isRetired = false;
            let justRetiredThisMonth = false;

            const retireAge = inc.retirementAge || 60;
            const currentSimAge = simFamilies.find(sf => sf.id === f.id).age;

            if (currentSimAge >= retireAge) {
                isRetired = true;
                // 今月が「退職年齢になった年の1月」なら退職月扱い
                // (simAgeは1月に増えるので、増えた直後の1月 = 退職月)
                if (currentSimAge === retireAge && currentMonthNum === 1) {
                    justRetiredThisMonth = true;
                }
            }

            if (isRetired) {
                // 年金生活 (年金はインフレ連動と仮定)
                monthlyIncomeTotal += (inc.pension * inflationFactor);
            } else {
                // 現役 (定額昇給ロジック: 月給に (昇給額 * 年数) を加算)
                const yearlyIncrease = (s.salaryIncreaseAmount || 0) * yearsPassed;
                const adjustedMonthly = inc.monthly + yearlyIncrease;

                monthlyIncomeTotal += adjustedMonthly;

                // ボーナス (平準化): 月給の増加率に合わせて連動させる
                // Bonus * (NewMonthly / OldMonthly)
                if (inc.bonus > 0) {
                    const ratio = inc.monthly > 0 ? (adjustedMonthly / inc.monthly) : 1;
                    const adjustedBonus = inc.bonus * ratio;
                    monthlyIncomeTotal += (adjustedBonus / 12);
                }
            }

            // 退職金の加算 (退職月のみ)
            // 退職金はインフレ連動のままとする(将来価値)
            if (justRetiredThisMonth) {
                monthlyIncomeTotal += (inc.severance * inflationFactor);
            }
        });

        let monthlyFlow = monthlyIncomeTotal;

        // B. 支出の減算 (基本生活費 + インフレ)
        // 増える生活費 = ベース生活費 * (1+r)^t
        let currentMonthExpense = baseLivingCost * inflationFactor;

        // C. ライフプラン補正
        // 1月の時点で年齢を加算 (簡易)
        if (currentMonthNum === 1 && i > 0) {
            simFamilies.forEach(f => f.age++);
        }

        // C-1. 教育費 & 子供補正
        let activeChildren = 0;
        simFamilies.forEach(f => {
            // 本人以外の家族を「子供」とみなす簡易判定 (本来は続柄が必要だが、年齢で判定)
            // 25歳以下を子供とみなして計算
            if (f.age <= s.childIndependenceAge) {
                // 教育費
                const eduCost = getEducationCost(f.age, s.educationMode);
                monthlyFlow -= eduCost;
                totalEduCost += eduCost; // 集計

                // ★追加: 成長に伴う生活費増分
                const growCost = getGrowthExpense(f.age);
                // インフレ考慮
                const inflatedGrowCost = growCost * inflationFactor;
                monthlyFlow -= inflatedGrowCost;
                // これは生活費の一部として計上
                totalLivingCost += inflatedGrowCost;

                // ★追加: 大学自宅外通学の仕送り (18-21歳)
                if (f.age >= 18 && f.age <= 21 && s.univHousingType === 'away') {
                    // 仕送り (インフレ考慮)
                    const allowance = (s.univAllowance || 100000) * inflationFactor;
                    monthlyFlow -= allowance;
                    totalLivingCost += allowance; // 生活費の一部とする
                }

                activeChildren++;
            }
        });


        // C-2. 自立後の生活費削減
        if (fams.length > 1 && activeChildren === 0) {
            // 削減適用: currentMonthExpense を減らす
            const reductionAmount = currentMonthExpense * (s.costReductionRate / 100);
            currentMonthExpense -= reductionAmount;
        }

        monthlyFlow -= currentMonthExpense;
        totalLivingCost += currentMonthExpense; // 集計

        // D-1. 定期支出 (数年に一度)
        recurring.forEach(exp => {
            // 免許返納チェック
            const mainMember = simFamilies[0];
            if (mainMember && mainMember.age >= s.licenseReturnAge) {
                // カテゴリ指定 または 名称検索
                if (exp.category === 'vehicle' || exp.name.includes("車") || exp.name.includes("Car") || exp.name.includes("保険")) {
                    return; // 支出しない
                }
            }

            if (currentMonthYM.localeCompare(exp.startYM) >= 0) {
                const diffM = diffMonths(currentMonthYM, exp.startYM);
                const intervalMonths = exp.intervalYears * 12;
                if (intervalMonths > 0 && diffM % intervalMonths === 0) {
                    monthlyFlow -= exp.amount;
                    totalRecurringCost += exp.amount; // 集計
                }
            }
        });

        // D-2. ローン (毎月)
        if (loans) {
            loans.forEach(loan => {
                if (currentMonthYM >= loan.startYM && currentMonthYM <= loan.endYM) {
                    monthlyFlow -= loan.monthlyAmount;
                    totalLoanCost += loan.monthlyAmount; // 集計
                }
            });
        }

        // E. 将来イベント
        appData.futureEvents.forEach(evt => {
            const fam = simFamilies.find(f => f.id === evt.familyId);
            if (!fam) return;
            const targetAge = evt.targetAge;
            const isTargetMonth = evt.targetMonth === currentMonthNum;

            if (fam.age === targetAge && isTargetMonth) {
                monthlyFlow -= evt.amount;
            }
        });

        // F. 資産運用
        // 毎月の積立額を Cash から Investment に移動
        let investAmount = s.investmentMonthly || 0;

        // 破綻防止: 現金がマイナスでも積立は止める？ いったん続ける設定
        monthlyFlow -= investAmount;
        totalInvestCost += investAmount; // 集計(支出として扱うか資産移動として扱うかだが、キャッシュフロー的には支出)

        // 運用の利回り計算 (月利)
        // 年利 r% -> 月利 R = r / 12 / 100
        const monthlyRate = (s.investmentYield || 0) / 100 / 12;

        // 投資残高の増加 (先月までの残高 * 利回り + 今月の積立)
        // 資産残高の更新
        // ... (省略せず既存ロジック維持)
        if (i === 0) {
            // 初月
            currentInvestment += investAmount;
        } else {
            // 運用益
            currentInvestment = currentInvestment * (1 + s.investmentYield / 100 / 12) + investAmount;
        }

        // G. 総残高更新
        // 総資産 = 現金残高(Income-Expense-Investで増減) + 投資残高(Invest+Profitで増減)
        // Asset(t) = Asset(t-1) + (Income - Expense - Invest) + (Invest + Profit)
        //          = Asset(t-1) + Income - Expense + Profit
        // currentTotal は「総資産」として扱われていた。
        // monthlyFlow は (Income - Expenses - Invest) なので
        // currentTotal += monthlyFlow + investAmount; // 投資分は総資産から減らさない
        // さらに運用益を加算
        // if(i > 0) currentTotal += investmentGain; // investmentGain は currentInvestment の計算に含まれる

        // currentTotal (総資産) の更新
        // monthlyFlow は (収入 - 支出 - 積立投資額)
        // currentTotal は総資産なので、積立投資額は現金から投資へ移動するだけで総資産は減らない。
        // よって、monthlyFlow に積立投資額を戻して、運用益を加える。
        currentTotal += monthlyFlow + investAmount; // 現金変動分 + 積立投資額
        // 投資の運用益は currentInvestment に既に反映されているので、それを currentTotal にも反映
        // ただし、currentInvestment は `currentInvestment = currentInvestment * (1 + monthlyRate) + investAmount;`
        // と計算されているため、この `investAmount` は既に `monthlyFlow` から引かれているもの。
        // したがって、`currentTotal` には `monthlyFlow` と `currentInvestment` の差分を足す。
        // `currentTotal` は `latestBalance.total` から始まる「総資産」
        // `currentInvestment` は「投資資産」
        // `currentTotal` = `現金` + `投資`
        // `現金` の変化 = `monthlyFlow` (収入 - 支出 - 積立)
        // `投資` の変化 = `積立` + `運用益`
        // `総資産` の変化 = `現金` の変化 + `投資` の変化
        //                = `monthlyFlow` + (`積立` + `運用益`)
        //                = (`収入 - 支出 - 積立`) + `積立` + `運用益`
        //                = `収入 - 支出 + 運用益`

        // 運用益を計算
        const investmentProfit = (currentInvestment - investAmount) * monthlyRate;
        currentTotal += monthlyFlow + investAmount + investmentProfit;


        // 結果格納
        result.data.push(currentTotal);
        result.investmentData.push(currentInvestment);
        result.labels.push(currentMonthYM);

        if (currentTotal < 0 && crashMonth === null) {
            crashMonth = currentMonthYM;
        }

        currentMonthDate = addMonth(currentMonthDate);
    }

    result.crashMonth = crashMonth;
    result.breakdown = {
        living: Math.round(totalLivingCost),
        education: Math.round(totalEduCost),
        loan: Math.round(totalLoanCost),
        recurring: Math.round(totalRecurringCost),
        investment: Math.round(totalInvestCost)
    };

    return result;
};

// ====================================================================
// V. UIレンダリングとナビゲーション
// ====================================================================

/**
 * 画面を切り替える。
 * @param {string} screenId - 画面ID ('dashboard', 'settings', 'balance-input', 'data-management')
 */
const navigate = (screenId) => {
    currentScreen = screenId;
    renderScreen();
    updateNavBar();
};

/**
 * ナビゲーションバーのアクティブ状態を更新する。
 */
const updateNavBar = () => {
    document.querySelectorAll('.nav-item').forEach(btn => {
        if (btn.dataset.screen === currentScreen) {
            btn.classList.add('nav-item-active', 'text-blue-500');
            btn.classList.remove('text-gray-400');
        } else {
            btn.classList.remove('nav-item-active', 'text-blue-500');
            btn.classList.add('text-gray-400');
        }
    });
    // Lucideアイコンを再描画
    // Lucideアイコンはscript.jsで初期化されるため、ここでは再実行
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
    }
};

/**
 * メイン画面のコンテンツをレンダリングする。
 */
const renderScreen = () => {
    const contentDiv = document.getElementById('app-content');
    contentDiv.innerHTML = '';
    window.scrollTo(0, 0); // 画面切り替え時にトップへスクロール

    switch (currentScreen) {
        case 'dashboard':
            renderDashboard(contentDiv);
            break;
        case 'settings':
            renderSettings(contentDiv);
            break;
        case 'balance-input':
            renderBalanceInput(contentDiv);
            break;
        case 'data-management':
            renderDataManagementTab(contentDiv); // Fix: Correct function name match
            break;
    }
};

// --- ダッシュボード画面のレンダリング ---
const renderDashboard = (container) => {
    // ************************************************************
    // ★修正箇所★: .pop()によるデータ破壊を防ぐため、最新データを安全に取得
    // ************************************************************
    const balancesSorted = [...appData.monthlyBalances].sort((a, b) => a.month.localeCompare(b.month));
    const latestBalance = balancesSorted.length > 0 ? balancesSorted[balancesSorted.length - 1] : null;
    // ************************************************************

    const coreChange = calculateCoreMonthlyChange();
    const simulationResult = runSimulation();
    const hasEnoughData = appData.monthlyBalances.length >= 2;

    let summaryHtml = `
        <div class="space-y-4">
            <div class="grid grid-cols-2 gap-4">
                <div class="card p-3">
                    <p class="text-sm text-gray-400">最新の総残高 (${latestBalance ? latestBalance.month : 'N/A'})</p>
                    <p class="text-2xl font-bold ${latestBalance && latestBalance.total < 0 ? 'text-red-400' : 'text-green-400'}">
                        ${latestBalance ? formatCurrency(latestBalance.total) : formatCurrency(0)}
                    </p>
                </div>
                <div class="card p-3">
                    <p class="text-sm text-gray-400">現在の月間収支 (推定)</p>
                    ${(() => {
            // 収支計算
            let totalIncome = 0;
            const s = appData.settings;
            const familyIncomes = s.familyIncomes || {};

            // 家族ごとの収入合算 (現役のみ簡易計算)
            appData.families.forEach(f => {
                const inc = familyIncomes[f.id];
                if (inc) {
                    // 今現在現役か？ (簡易: 年齢 < 退職年齢)
                    const retireAge = inc.retirementAge || 60;
                    if (f.age < retireAge) {
                        totalIncome += inc.monthly;
                        totalIncome += (inc.bonus / 12);
                    } else {
                        totalIncome += inc.pension;
                    }
                }
            });

            // 支出: 基本生活費 + ローン
            let totalExpense = s.currentLivingCost || 250000;

            // ローン (現在の年月で有効なもの)
            const now = new Date();
            const currentYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            if (appData.loans) {
                appData.loans.forEach(l => {
                    if (currentYM >= l.startYM && currentYM <= l.endYM) {
                        totalExpense += l.monthlyAmount;
                    }
                });
            }

            const surplus = totalIncome - totalExpense;
            const colorClass = surplus >= 0 ? 'text-green-400' : 'text-red-400';

            return `
                        <p class="text-2xl font-bold ${colorClass}">
                            ${formatCurrency(surplus)}
                        </p>
                        <p class="text-xs text-gray-500 mt-1">
                           収入: ${formatCurrency(totalIncome)} - 支出: ${formatCurrency(totalExpense)}
                        </p>
                        `;
        })()}
                </div>
            </div>
    `;

    if (latestBalance) {
        const totalMonths = simulationResult.labels.length;
        // latestBalanceがnullでないことを保証してからアクセスする
        const predictionStart = latestBalance.month;
        const predictionEnd = simulationResult.labels[totalMonths - 1];
        let riskText;

        if (!hasEnoughData) {
            riskText = `
                <p class="text-orange-400 font-semibold flex items-center">
                    <i data-lucide="info" class="w-5 h-5 mr-2"></i>
                    予測の精度向上には2ヶ月以上の実績が必要です。
                </p>
            `;
        } else if (simulationResult.crashMonth) {
            const monthsToCrash = diffMonths(simulationResult.crashMonth, predictionStart);
            const years = Math.floor(monthsToCrash / 12);
            const months = monthsToCrash % 12;

            riskText = `
                <p class="text-alert-color font-semibold flex items-center">
                    <i data-lucide="alert-triangle" class="w-5 h-5 mr-2"></i>
                    <span class="animate-pulse">⚠️ 破産リスクあり: ${simulationResult.crashMonth}</span>
                </p>
                <p class="text-sm text-gray-300 ml-7">残り ${years}年 ${months}ヶ月で総残高がマイナスになります。</p>
            `;
        } else {
            riskText = `
                <p class="text-green-400 font-semibold flex items-center">
                    <i data-lucide="check-circle" class="w-5 h-5 mr-2"></i>
                    予測期間 (${appData.settings.predictionYears}年) 中に破産リスクはありません。
                </p>
            `;
        }

        summaryHtml += `
            <div class="card p-3 space-y-2">
                <h3 class="text-lg font-bold">破産リスク分析</h3>
                ${riskText}
                <p class="text-xs text-gray-500 mt-2">予測期間: ${predictionStart} の翌月 〜 ${predictionEnd}</p>
            </div>
        `;
    } else {
        summaryHtml += `<div class="card p-3 text-center text-gray-400">残高実績データが不足しています。残高を入力してください。</div>`;
    }

    summaryHtml += `</div><h2 class="text-2xl font-bold mt-6 mb-3">総資産の長期予測 (${appData.settings.predictionYears}年)</h2>`;
    container.innerHTML += summaryHtml;

    // グラフコンテナ + 内訳チャート
    container.innerHTML += `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div class="lg:col-span-2 card">
                <div id="chart-container" style="height: 350px;">
                    <canvas id="balanceChart"></canvas>
                </div>
            </div>
            <div class="card">
                <div id="breakdown-container" style="height: 350px;">
                    <canvas id="breakdownChart"></canvas>
                </div>
            </div>
        </div>
        
        <h2 class="text-xl font-bold mt-6 mb-3">各口座の最新残高</h2>
        <div id="account-balances" class="card">
            ${renderAccountBalances(latestBalance)}
        </div>
        <div class="h-24"></div>
    `;

    // シミュレーション実行 (現在の設定)
    // const simulationResult = runSimulation(); // 既に上部で計算済みなので再利用

    // 保存済みシナリオの計算
    const scenarioResults = [];
    if (appData.scenarios) {
        appData.scenarios.forEach(sc => {
            const res = runSimulation(sc.settings, sc.families, sc.loans, sc.recurring);
            scenarioResults.push({ name: sc.name, data: res.data });
        });
    }

    // 結果統合
    const finalData = { ...simulationResult, scenarios: scenarioResults };

    // Chart.jsの描画
    if (latestBalance) {
        // 実績データを渡す
        drawChart(finalData, balancesSorted, latestBalance.total, latestBalance.month, simulationResult.crashMonth);
        renderBreakdownChart('breakdownChart', simulationResult.breakdown);
    } else {
        document.getElementById('chart-container').innerHTML = '<p class="text-center text-gray-400 py-10">残高実績を登録するとグラフが表示されます。</p>';
    }

    // Lucideアイコンを再描画
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
    }
};

/**
 * 最新の口座残高をレンダリングする。
 * @param {Object} latestBalance - 最新の月次残高データ
 * @returns {string} HTML文字列
 */
const renderAccountBalances = (latestBalance) => {
    if (!latestBalance) {
        return '<p class="text-gray-400">残高実績がありません。</p>';
    }

    if (appData.accounts.length === 0) {
        return '<p class="text-gray-400">口座情報が登録されていません。</p>';
    }

    let html = '<ul class="space-y-2">';
    appData.accounts.forEach(account => {
        const balance = latestBalance.accounts[account.id] || 0;
        html += `
            <li class="flex justify-between items-center py-1 border-b border-gray-700 last:border-b-0">
                <span class="text-gray-300">${account.name}</span>
                <span class="font-semibold ${balance < 0 ? 'text-red-400' : 'text-green-400'}">${formatCurrency(balance)}</span>
            </li>
        `;
    });
    html += '</ul>';
    return html;
};

/**
 * Chart.jsを使用して予測グラフを描画する。
 * @param {Object} data - シミュレーション結果データ
 * @param {number} startBalance - 最新の実績残高
 * @param {string} startMonth - 最新の実績月
 * @param {string | null} crashMonth - 破産月
 */
/**
 * Chart.jsを使用して予測グラフを描画する。
 * @param {Object} data - シミュレーション結果データ (data.labels, data.data, data.investmentData, data.scenarios)
 * @param {Array} historyData - 過去の実績データの配列 [{month, total, accounts}, ...]
 * @param {number} startBalance - 最新の実績残高
 * @param {string} startMonth - 最新の実績月
 * @param {string | null} crashMonth - 破産月
 */
const drawChart = (data, historyData, startBalance, startMonth, crashMonth) => {
    if (simulationChart) {
        simulationChart.destroy();
    }
    const ctx = document.getElementById('balanceChart').getContext('2d');

    // 1. ラベルの統合 (実績の過去分 + シミュレーションの未来分)
    // historyData (過去 -> 現在) + data.labels (現在 -> 未来)
    // 重複する「現在(最新月)」はそのまま重ねるか、ユニークにする
    const historyLabels = historyData.map(d => d.month);
    const simulationLabels = data.labels;

    // Setを使って重複排除しつつ結合し、ソート
    const allLabelsSet = new Set([...historyLabels, ...simulationLabels]);
    const allLabels = Array.from(allLabelsSet).sort((a, b) => a.localeCompare(b));

    // 2. データセットの作成
    // ラベルに対応するデータを作成する（値がない場所は null）

    // 実績データマップ
    const historyMap = new Map();
    historyData.forEach(d => historyMap.set(d.month, d.total));

    // シミュレーションデータマップ (investmentData含む)
    const simTotalMap = new Map();
    const simInvestMap = new Map();
    data.labels.forEach((label, idx) => {
        simTotalMap.set(label, data.data[idx]);
        simInvestMap.set(label, data.investmentData[idx]);
    });

    const historyPoints = [];
    const simTotalPoints = [];
    const simInvestPoints = [];

    // 破産リスク表示用のインデックス特定用
    let crashIndex = -1;

    allLabels.forEach((label, index) => {
        // 実績: あれば値、なければnull
        // ただし、線をつなぐために「シミュレーションの開始点(=最新実績)」も実績データとして扱うと綺麗につながる
        // 既存の historyData には最新月が含まれているはずなので、そのままマップから取得でOK
        if (historyMap.has(label)) {
            historyPoints.push(historyMap.get(label));
        } else {
            historyPoints.push(null);
        }

        // 予測: あれば値、なければnull
        if (simTotalMap.has(label)) {
            simTotalPoints.push(simTotalMap.get(label));
        } else {
            simTotalPoints.push(null);
        }

        if (simInvestMap.has(label)) {
            simInvestPoints.push(simInvestMap.get(label));
        } else {
            simInvestPoints.push(null);
        }

        if (label === crashMonth) {
            crashIndex = index;
        }
    });

    const datasets = [
        // 1. 実績線 (濃い青、実線)
        {
            label: '実績残高',
            data: historyPoints,
            borderColor: '#2563eb', // Blue-600
            backgroundColor: 'transparent',
            borderWidth: 3,
            pointRadius: historyData.length === 1 ? 4 : 0, // 点が1つだけなら丸を表示
            pointHoverRadius: 5,
            tension: 0.2,
            fill: false,
            order: 1 // 手前
        },
        // 2. シミュレーション予測 (薄い青、塗りつぶし)
        {
            label: '将来予測 (総資産)',
            data: simTotalPoints,
            borderColor: 'var(--accent-color)', // Light Blue
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            borderWidth: 3,
            borderDash: [2, 2], // 予測なので少し点線っぽくするか、色を変えるか。今回は実線のままスタイル維持
            pointRadius: 0,
            tension: 0.2,
            fill: true,
            order: 2
        },
        // 3. 運用資産内訳 (緑、点線)
        {
            label: 'うち運用資産',
            data: simInvestPoints,
            borderColor: '#10b981', // Green
            borderWidth: 2,
            borderDash: [4, 4], // 点線
            pointRadius: 0,
            tension: 0.2,
            fill: false,
            order: 0 // 最前面
        }
    ];

    // シナリオデータの追加描画
    if (data.scenarios && data.scenarios.length > 0) {
        data.scenarios.forEach((sc, idx) => {
            // シナリオデータのマッピング
            const scMap = new Map();
            // シナリオデータは simulationLabels と対応している
            data.labels.forEach((l, i) => scMap.set(l, sc.data[i]));

            const scPoints = allLabels.map(l => scMap.has(l) ? scMap.get(l) : null);

            const colors = ['#f472b6', '#a78bfa', '#facc15']; // Pink, Purple, Yellow
            datasets.push({
                label: `Plan: ${sc.name}`,
                data: scPoints,
                borderColor: colors[idx % colors.length],
                borderWidth: 2,
                borderDash: [5, 5],
                pointRadius: 0,
                tension: 0.2,
                fill: false,
                order: 3
            });
        });
    }

    if (crashIndex !== -1) {
        // 破産ポイント
        // 全ラベル対応にするためマッピング
        // 破産月以降のデータを抽出
        const crashPoints = allLabels.map((l, i) => (i >= crashIndex && simTotalPoints[i] !== null) ? simTotalPoints[i] : NaN);

        datasets.push({
            label: '破産リスク',
            data: crashPoints,
            borderColor: 'var(--alert-color)',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: 'var(--alert-color)',
            pointBorderColor: 'var(--alert-color)',
            tension: 0.1,
            fill: false,
            showLine: true,
            order: 0
        });
    }

    simulationChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: allLabels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#e5e7eb' }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            if (context.raw === null || context.raw === undefined || isNaN(context.raw)) return null;
                            return context.dataset.label + ': ' + formatCurrency(context.parsed.y);
                        }
                    },
                    bodyFont: { family: 'Inter', size: 14 },
                    titleFont: { family: 'Inter', size: 14 }
                }
            },
            scales: {
                x: {
                    grid: { color: '#374151' },
                    ticks: {
                        color: 'var(--text-color)',
                        autoSkip: false, // 自動間引きを無効化してcallbackで制御
                        maxRotation: 0,
                        callback: function (val, index) {
                            const label = this.getLabelForValue(val);
                            if (!label) return null;

                            const [year, month] = label.split('-');
                            const totalLabels = this.chart.data.labels.length;
                            const mNum = Number(month);
                            const yNum = Number(year);

                            // 1. 最初のデータは常に表示
                            if (index === 0) {
                                // 期間が長い場合(2年以上)は月を省略して「年」のみにして被りを防ぐ
                                if (totalLabels > 24) {
                                    return `${year}年`;
                                }
                                return `${year}年${month}月`;
                            }

                            // 重なり防止: 最初のラベルから近すぎる定期ラベルは表示しない
                            // 全体の15%未満の位置にあるラベルはスキップ
                            if (index < totalLabels * 0.15) {
                                return null;
                            }

                            // 2. 期間に応じた間引きロジック (スマホ想定でラベル数を5-7個程度に抑える)
                            // totalLabels / 12 = 年数

                            if (totalLabels <= 24) {
                                // 2年以内: 6ヶ月ごと (約4個)
                                if (mNum % 6 === 1) return `${year}年${month}月`;
                                return null;
                            } else if (totalLabels <= 60) {
                                // 5年以内: 毎年 (約5個)
                                if (month === '01') return `${year}年`;
                                return null;
                            } else if (totalLabels <= 120) {
                                // 10年以内: 2年ごと (約5個)
                                // 西暦偶数年を表示
                                if (month === '01' && yNum % 2 === 0) return `${year}年`;
                                return null;
                            } else if (totalLabels <= 300) {
                                // 25年以内: 5年ごと (約5個)
                                if (month === '01' && yNum % 5 === 0) return `${year}年`;
                                return null;
                            } else {
                                // それ以上(50年〜100年): 10年ごと (約5-10個)
                                if (month === '01' && yNum % 10 === 0) return `${year}年`;
                                return null;
                            }

                            return null;
                        }
                    }
                },
                y: {
                    beginAtZero: false,
                    grid: { color: '#374151' },
                    ticks: {
                        color: 'var(--text-color)',
                        callback: function (value) {
                            if (value >= 100000000) return (value / 100000000).toFixed(1) + '億';
                            if (value >= 10000) return (value / 10000).toFixed(0) + '万';
                            return formatCurrency(value);
                        }
                    }
                }
            }
        }
    });
};

// --- 設定・登録画面のレンダリング ---
const renderSettings = (container) => {
    container.innerHTML = `
        <h2 class="text-2xl font-bold mb-4">設定・データ登録</h2>

        <div class="flex border-b border-gray-700 mb-6 overflow-x-auto hide-scrollbar">
            <button data-tab="family-account" onclick="setSettingsTab('family-account')" class="settings-tab-btn py-2 px-4 text-sm font-medium transition duration-150 border-b-2 border-transparent whitespace-nowrap">家族・口座情報</button>
            <button data-tab="recurring" onclick="setSettingsTab('recurring')" class="settings-tab-btn py-2 px-4 text-sm font-medium transition duration-150 border-b-2 border-transparent whitespace-nowrap">定期支出</button>
            <button data-tab="future-event" onclick="setSettingsTab('future-event')" class="settings-tab-btn py-2 px-4 text-sm font-medium transition duration-150 border-b-2 border-transparent whitespace-nowrap">将来イベント</button>
            <button data-tab="sim-config" onclick="setSettingsTab('sim-config')" class="settings-tab-btn py-2 px-4 text-sm font-medium transition duration-150 border-b-2 border-transparent whitespace-nowrap">シミュレーション設定</button>
        </div>

        <div id="settings-tab-content"></div>
        `;
    setSettingsTab(currentSettingTab);
};

/**
 * 設定画面のタブを切り替える。
 * @param {string} tab - タブID
 */
const setSettingsTab = (tab) => {
    currentSettingTab = tab;
    const contentDiv = document.getElementById('settings-tab-content');

    // ボタンのアクティブ状態を更新
    document.querySelectorAll('.settings-tab-btn').forEach(btn => {
        if (btn.dataset.tab === tab) {
            btn.classList.add('border-blue-500', 'text-blue-500');
            btn.classList.remove('text-gray-400', 'hover:text-blue-400');
        } else {
            btn.classList.remove('border-blue-500', 'text-blue-500');
            btn.classList.add('text-gray-400', 'hover:text-blue-400');
        }
    });

    switch (tab) {
        case 'family-account':
            contentDiv.innerHTML = renderFamilyAccountTab();
            break;
        case 'recurring':
            contentDiv.innerHTML = renderRecurringTab();
            break;
        case 'future-event':
            contentDiv.innerHTML = renderFutureEventTab();
            break;
        case 'sim-config':
            contentDiv.innerHTML = renderSimConfigTab();
            break;
    }
    // Lucideアイコンを再描画
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
    }
    // イベントリスナーの再登録
    document.getElementById('add-account-form')?.addEventListener('submit', handleAddAccount);
    document.getElementById('add-family-form')?.addEventListener('submit', handleAddFamily);
    document.getElementById('add-recurring-form')?.addEventListener('submit', handleAddRecurring);
    document.getElementById('add-loan-form')?.addEventListener('submit', handleAddLoan);
    document.getElementById('add-future-event-form')?.addEventListener('submit', handleAddFutureEvent);
    document.getElementById('sim-config-form')?.addEventListener('submit', handleSimConfigUpdate);
};

// --- 設定タブのレンダリング関数 ---

const renderFamilyAccountTab = () => {
    let html = `
        <div class="card mb-6">
            <h3 class="text-xl font-bold mb-3 border-b border-gray-700 pb-2">口座情報登録</h3>
            <form id="add-account-form" class="space-y-3">
                <label for="account-name" class="block text-sm font-medium mb-1 text-gray-300">口座名</label>
                <input type="text" id="account-name" placeholder="例: メイン銀行" required
                    class="w-full p-2 rounded-lg focus:ring-blue-500 focus:border-blue-500">
                <button type="submit" class="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition duration-150">口座を追加</button>
            </form>
            <ul class="mt-4 space-y-2 border-t border-gray-700 pt-4">
                <p class="text-sm text-gray-400 mb-2">${appData.accounts.length}件の口座</p>
                ${appData.accounts.map(acc => `
                    <li class="flex justify-between items-center bg-gray-700 p-2 rounded-lg">
                        <span>${acc.name}</span>
                        <button onclick="deleteItem('accounts', '${acc.id}')" class="text-red-400 hover:text-red-500 p-1">
                            <i data-lucide="x" class="w-5 h-5"></i>
                        </button>
                    </li>
                `).join('')}
            </ul>
        </div>

        <div class="card">
            <h3 class="text-xl font-bold mb-3 border-b border-gray-700 pb-2">家族情報登録</h3>
            <form id="add-family-form" class="space-y-3">
                <label for="family-name" class="block text-sm font-medium mb-1 text-gray-300">氏名</label>
                <input type="text" id="family-name" placeholder="氏名" required
                    class="w-full p-2 rounded-lg focus:ring-blue-500 focus:border-blue-500">
                <div class="grid grid-cols-2 gap-3">
                     <div>
                        <label for="family-age" class="block text-sm font-medium mb-1 text-gray-300">現在の年齢</label>
                        <input type="number" id="family-age" placeholder="年齢" min="0" required
                            class="w-full p-2 rounded-lg focus:ring-blue-500 focus:border-blue-500">
                    </div>
                    <div>
                        <label for="family-birth-month" class="block text-sm font-medium mb-1 text-gray-300">誕生日月</label>
                        <select id="family-birth-month" required
                            class="w-full p-2 rounded-lg focus:ring-blue-500 focus:border-blue-500">
                            <option value="">誕生日月を選択</option>
                            ${Array.from({ length: 12 }, (_, i) => i + 1).map(m => `<option value="${m}">${m}月</option>`).join('')}
                        </select>
                    </div>
                </div>
                <button type="submit" class="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition duration-150">家族を追加</button>
            </form>
            <ul class="mt-4 space-y-2 border-t border-gray-700 pt-4">
                <p class="text-sm text-gray-400 mb-2">${appData.families.length}件の家族</p>
                ${appData.families.map(fam => `
                    <li class="flex justify-between items-center bg-gray-700 p-2 rounded-lg">
                        <span>${fam.name} (${fam.age}歳, ${fam.birthMonth}月生)</span>
                        <button onclick="deleteItem('families', '${fam.id}')" class="text-red-400 hover:text-red-500 p-1">
                            <i data-lucide="x" class="w-5 h-5"></i>
                        </button>
                    </li>
                `).join('')}
            </ul>
        </div>
        <div class="h-24"></div>
    `;
    return html;
};

const renderRecurringTab = () => {
    // 今日のYYYY-MMをデフォルト値として取得
    const todayYM = new Date().toISOString().slice(0, 7);

    let html = `
        <!-- ローン・固定費セクション -->
        <div class="card mb-6 border-l-4 border-red-500">
            <h3 class="text-xl font-bold mb-3 border-b border-gray-700 pb-2">ローン・毎月の固定費 (期間限定)</h3>
            <p class="text-sm text-gray-400 mb-3">住宅ローンや奨学金など、支払いに「終了」がある毎月の固定費を登録します。</p>
            <form id="add-loan-form" class="space-y-3">
                <input type="text" id="loan-name" placeholder="名称 (例: 住宅ローン)" required class="w-full p-2 rounded-lg">
                <input type="number" id="loan-amount" placeholder="月々の支払額 (円)" min="1" required class="w-full p-2 rounded-lg">
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs text-gray-400">開始年月</label>
                        <input type="month" id="loan-start" value="${todayYM}" required class="w-full p-2 rounded-lg">
                    </div>
                    <div>
                        <label class="block text-xs text-gray-400">終了年月</label>
                        <input type="month" id="loan-end" required class="w-full p-2 rounded-lg">
                    </div>
                </div>
                <button type="submit" class="w-full py-2 bg-red-600 hover:bg-red-700 rounded-lg font-semibold">ローンを追加</button>
            </form>
            <ul class="mt-4 space-y-2 border-t border-gray-700 pt-4">
                ${appData.loans && appData.loans.length > 0 ? appData.loans.map(loan => `
                    <li class="flex justify-between items-center bg-gray-700 p-2 rounded-lg text-sm">
                        <span>${loan.name}: ${formatCurrency(loan.monthlyAmount)}/月<br><span class="text-xs text-gray-400">${loan.startYM} 〜 ${loan.endYM}</span></span>
                        <button onclick="deleteItem('loans', '${loan.id}')" class="text-red-400 hover:text-red-500 p-1"><i data-lucide="x" class="w-5 h-5"></i></button>
                    </li>
                `).join('') : '<li class="text-gray-500 text-sm">登録されたローンはありません</li>'}
            </ul>
        </div>

        <!-- 定期的な特別出費セクション -->
        <div class="card mb-6 border-l-4 border-yellow-500">
            <h3 class="text-xl font-bold mb-3 border-b border-gray-700 pb-2">数年に一度の大型出費</h3>
            <p class="text-sm text-gray-400 mb-3">車検、更新料、旅行など数年ごとに発生する出費を登録します。</p>
            <form id="add-recurring-form" class="space-y-3">
                <label for="recurring-name" class="block text-sm font-medium mb-1 text-gray-300">支出名前</label>
                <input type="text" id="recurring-name" placeholder="例: 年払い保険" required
                    class="w-full p-2 rounded-lg">
                
                <label for="recurring-amount" class="block text-sm font-medium mb-1 text-gray-300">金額 (JPY)</label>
                <input type="number" id="recurring-amount" placeholder="金額" min="1" required
                    class="w-full p-2 rounded-lg">
                
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label for="recurring-interval" class="block text-sm font-medium mb-1 text-gray-300">支払い間隔</label>
                        <select id="recurring-interval" required
                            class="w-full p-2 rounded-lg">
                            <option value="">支払い間隔を選択</option>
                            ${RECURRING_INTERVALS.map(y => `<option value="${y}">${y}年</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label for="recurring-start-ym" class="block text-sm font-medium mb-1 text-gray-300">支払い開始年月</label>
                        <input type="month" id="recurring-start-ym" value="${todayYM}" required
                            class="w-full p-2 rounded-lg">
                    </div>
                </div>
                <div>
                   <label class="block text-sm font-medium mb-1 text-gray-300">カテゴリ</label>
                   <select id="recurring-category" class="w-full p-2 rounded-lg">
                       <option value="other">その他</option>
                       <option value="vehicle">車両関連 (免許返納で停止)</option>
                       <option value="housing">住宅関連</option>
                       <option value="insurance">保険</option>
                       <option value="education">教育関連</option>
                   </select>
                </div>
                <button type="submit" class="w-full py-2 bg-yellow-600 hover:bg-yellow-700 rounded-lg font-semibold">定期支出を追加</button>
            </form>
            <ul class="mt-4 space-y-2 border-t border-gray-700 pt-4">
                <p class="text-sm text-gray-400 mb-2">${appData.recurringExpenses.length}件の定期支出</p>
                ${appData.recurringExpenses.map(exp => {
        const catLabel = { vehicle: '車両', housing: '住宅', insurance: '保険', education: '教育', other: 'その他' }[exp.category] || 'その他';
        return `
                    <li class="flex justify-between items-center bg-gray-700 p-2 rounded-lg">
                        <span><span class="text-xs bg-gray-600 px-1 rounded mr-1">${catLabel}</span>${exp.name}: ${formatCurrency(exp.amount)} (${exp.intervalYears}年ごと・開始${exp.startYM})</span>
                        <button onclick="deleteItem('recurringExpenses', '${exp.id}')" class="text-red-400 hover:text-red-500 p-1">
                            <i data-lucide="x" class="w-5 h-5"></i>
                        </button>
                    </li>
                    `;
    }).join('')}
            </ul>
        </div>
        <div class="h-24"></div>
    `;

    // イベントリスナー登録はここでやらないとDOM更新後に消えるため、setSettingsTabで呼ぶ形にするか、ここでインライン的に書くなら後段の処理が必要
    // script.jsの構造上、setSettingsTabでリスナー付与しているはずなので、IDが一致していればOK
    // ただし add-loan-form は新規追加なので setSettingsTab に定義を追加する必要あり
    return html;
};

const renderFutureEventTab = () => {
    if (appData.families.length === 0) {
        return `
            <div class="card p-4 text-center">
                <p class="text-gray-400">将来イベントを登録するには、まず「家族・口座情報」タブで家族を登録してください。</p>
                <button onclick="setSettingsTab('family-account')" class="mt-3 py-1 px-3 bg-blue-600 rounded-lg text-sm">家族を登録</button>
            </div>
            <div class="h-24"></div>
        `;
    }

    let html = `
        <div class="card mb-6">
            <h3 class="text-xl font-bold mb-3 border-b border-gray-700 pb-2">将来イベント登録</h3>
            <form id="add-future-event-form" class="space-y-3">
                <label for="event-name" class="block text-sm font-medium mb-1 text-gray-300">イベント名</label>
                <input type="text" id="event-name" placeholder="例: 住宅購入頭金, 大学入学" required
                    class="w-full p-2 rounded-lg">
                
                <label for="event-amount" class="block text-sm font-medium mb-1 text-gray-300">金額 (JPY)</label>
                <input type="number" id="event-amount" placeholder="金額" min="1" required
                    class="w-full p-2 rounded-lg">
                
                <label for="event-family-id" class="block text-sm font-medium mb-1 text-gray-300">対象家族</label>
                <select id="event-family-id" required
                    class="w-full p-2 rounded-lg">
                    <option value="">対象家族を選択</option>
                    ${appData.families.map(fam => `<option value="${fam.id}">${fam.name} (現${fam.age}歳)</option>`).join('')}
                </select>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label for="event-target-age" class="block text-sm font-medium mb-1 text-gray-300">目標年齢</label>
                        <input type="number" id="event-target-age" placeholder="目標年齢" min="1" required
                            class="w-full p-2 rounded-lg">
                    </div>
                    <div>
                        <label for="event-target-month" class="block text-sm font-medium mb-1 text-gray-300">発生月</label>
                        <select id="event-target-month" required
                            class="w-full p-2 rounded-lg">
                            <option value="">発生月を選択</option>
                            ${Array.from({ length: 12 }, (_, i) => i + 1).map(m => `<option value="${m}">${m}月</option>`).join('')}
                        </select>
                    </div>
                </div>
                <button type="submit" class="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold">イベントを追加</button>
            </form>
            <ul class="mt-4 space-y-2 border-t border-gray-700 pt-4">
                <p class="text-sm text-gray-400 mb-2">${appData.futureEvents.length}件の将来イベント</p>
                ${appData.futureEvents.map(event => {
        const famName = appData.families.find(f => f.id === event.familyId)?.name || '不明';
        const now = new Date();
        const currentYear = now.getFullYear();
        const family = appData.families.find(f => f.id === event.familyId);
        const eventYear = family ? (currentYear - family.age) + event.targetAge : 'N/A';
        return `
                        <li class="flex justify-between items-center bg-gray-700 p-2 rounded-lg text-sm">
                            <span>
                                ${event.name} (${formatCurrency(event.amount)})<br>
                                <span class="text-gray-400">${famName}が${event.targetAge}歳になる ${eventYear}年${event.targetMonth}月</span>
                            </span>
                            <button onclick="deleteItem('futureEvents', '${event.id}')" class="text-red-400 hover:text-red-500 p-1">
                                <i data-lucide="x" class="w-5 h-5"></i>
                            </button>
                        </li>
                    `;
    }).join('')}
            </ul>
        </div>
        <div class="h-24"></div>
    `;
    return html;
};

const renderSimConfigTab = () => {
    const s = appData.settings;
    let html = `
       <div class="card space-y-6">
           <h3 class="text-xl font-bold mb-3 border-b border-gray-700 pb-2">シミュレーション詳細設定</h3>
           <form id="sim-config-form" class="space-y-6">

               <!-- 1. 家族の収入・退職プラン -->
               <div class="space-y-3">
                   <h4 class="font-bold text-gray-200 border-l-4 border-purple-500 pl-2">1. 家族の収入・退職プラン</h4>
                   <p class="text-xs text-gray-400">18歳以上の家族について、収入と退職プランを設定します。</p>
                   <div class="space-y-4" id="family-income-config-area">
                       ${appData.families.filter(f => f.age >= 18).map(f => {
        const inc = (s.familyIncomes && s.familyIncomes[f.id]) || { monthly: 0, bonus: 0, retirementYM: '', severance: 0, pension: 0 };
        return `
                           <div class="bg-gray-700 p-4 rounded-lg border border-gray-600" data-family-id="${f.id}">
                               <div class="font-bold text-lg mb-2 text-purple-300 w-full border-b border-gray-600 pb-1 mb-3">${f.name} (${f.age}歳)</div>
                               <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                   <!-- 現役収入 -->
                                   <div>
                                       <label class="block text-xs text-gray-400">手取り月収 (円)</label>
                                       <input type="number" class="w-full p-2 rounded bg-gray-800 border border-gray-600 mt-1 f-income" value="${inc.monthly || 0}" step="10000">
                                   </div>
                                   <div>
                                       <label class="block text-xs text-gray-400">年間ボーナス (円)</label>
                                       <input type="number" class="w-full p-2 rounded bg-gray-800 border border-gray-600 mt-1 f-bonus" value="${inc.bonus || 0}" step="10000">
                                   </div>

                                   <!-- 退職設定 -->
                                   <div class="md:col-span-2 lg:col-span-1 border-t border-gray-600 pt-2 lg:border-t-0 lg:pt-0">
                                        <label class="block text-xs text-gray-400 text-yellow-200">退職年齢 (歳)</label>
                                        <input type="number" class="w-full p-2 rounded bg-gray-800 border border-gray-600 mt-1 f-retire-age" value="${inc.retirementAge || 60}" min="18" max="100">
                                   </div>
                                   <div class="md:col-span-1 border-t border-gray-600 pt-2 lg:border-t-0 lg:pt-0">
                                        <label class="block text-xs text-gray-400 text-yellow-200">退職金 (一時金)</label>
                                        <input type="number" class="w-full p-2 rounded bg-gray-800 border border-gray-600 mt-1 f-severance" value="${inc.severance || 0}" step="100000">
                                   </div>
                                   <div class="md:col-span-1 border-t border-gray-600 pt-2 lg:border-t-0 lg:pt-0">
                                        <label class="block text-xs text-gray-400 text-green-300">退職後の年金 (月額)</label>
                                        <input type="number" class="w-full p-2 rounded bg-gray-800 border border-gray-600 mt-1 f-pension" value="${inc.pension || 0}" step="10000">
                                   </div>
                               </div>
                           </div>
                           `;
    }).join('')}
                       ${appData.families.filter(f => f.age >= 18).length === 0 ? '<p class="text-sm text-red-400">18歳以上の家族が登録されていません。「設定・登録」→「家族・口座」から家族を登録してください。</p>' : ''}
                   </div>
               </div>
               
               <!-- 2. 期間・経済設定 -->
               <div class="space-y-3">
                   <h4 class="font-bold text-gray-200 border-l-4 border-blue-500 pl-2">2. 期間・経済設定</h4>
                   <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <div class="md:col-span-2">
                           <label class="block text-sm font-medium text-gray-300">現在の月間生活費 (基本支出)</label>
                           <input type="number" id="conf-living" value="${s.currentLivingCost || 250000}" step="10000" class="w-full p-2 rounded-lg mt-1">
                           <p class="text-xs text-gray-400 mt-1">※住宅ローン、教育費、大型出費を<b>除いた</b>、日々の生活費を入力してください。</p>
                       </div>
                       <div>
                           <label class="block text-sm font-medium text-gray-300">予測期間 (年)</label>
                           <input type="number" id="conf-years" value="${s.predictionYears}" min="1" max="50" class="w-full p-2 rounded-lg mt-1">
                       </div>
                       <div>
                           <label class="block text-sm font-medium text-gray-300">想定インフレ率 (年%)</label>
                           <input type="number" id="conf-inflation" value="${s.inflationRate}" step="0.1" class="w-full p-2 rounded-lg mt-1">
                       </div>
                   </div>
               </div>

               <!-- 3. 資産運用 -->
               <div class="space-y-3">
                   <h4 class="font-bold text-gray-200 border-l-4 border-green-500 pl-2">3. 資産運用 (NISA等)</h4>
                   <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <div>
                            <label class="block text-sm font-medium text-gray-300">毎月の積立額 (円)</label>
                            <div class="flex gap-2">
                                <input type="number" id="conf-invest-monthly" value="${s.investmentMonthly}" step="1000" class="w-full p-2 rounded-lg mt-1">
                                <button type="button" onclick="suggestInvestment()" class="whitespace-nowrap bg-teal-600 hover:bg-teal-700 text-xs px-3 rounded mt-1">推奨額を計算</button>
                            </div>
                       </div>
                       <div>
                           <label class="block text-sm font-medium text-gray-300">想定利回り (年%)</label>
                           <input type="number" id="conf-invest-yield" value="${s.investmentYield}" step="0.1" class="w-full p-2 rounded-lg mt-1">
                       </div>
                   </div>
               </div>

               <!-- 4. ライフプラン補正 -->
               <div class="space-y-3">
                   <h4 class="font-bold text-gray-200 border-l-4 border-orange-500 pl-2">4. ライフプラン補正</h4>
                   
                   <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <div>
                           <label class="block text-sm font-medium text-gray-300">教育費プラン</label>
                           <select id="conf-edu-mode" class="w-full p-2 rounded-lg mt-1">
                               <option value="public" ${s.educationMode === 'public' ? 'selected' : ''}>オール公立 (標準)</option>
                               <option value="public_private_univ" ${s.educationMode === 'public_private_univ' ? 'selected' : ''}>高校まで公立・大学私立</option>
                               <option value="private" ${s.educationMode === 'private' ? 'selected' : ''}>オール私立 (高コスト)</option>
                           </select>
                       </div>
                       <div>
                           <label class="block text-sm font-medium text-gray-300">免許返納年齢 (車両費停止)</label>
                           <input type="number" id="conf-license-age" value="${s.licenseReturnAge}" class="w-full p-2 rounded-lg mt-1">
                       </div>
                   </div>

                   <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <div>
                            <label class="block text-sm font-medium text-gray-300">大学進学時の居住形態</label>
                            <select id="conf-univ-housing" class="w-full p-2 rounded-lg mt-1" onchange="toggleUnivAllowance(this.value)">
                                <option value="home" ${s.univHousingType === 'home' ? 'selected' : ''}>自宅通学</option>
                                <option value="away" ${s.univHousingType === 'away' ? 'selected' : ''}>自宅外（下宿・一人暮らし）</option>
                            </select>
                       </div>
                       <div id="univ-allowance-area" class="${s.univHousingType === 'home' ? 'hidden' : ''}">
                           <label class="block text-sm font-medium text-gray-300">毎月の仕送り額（家賃込）</label>
                           <input type="number" id="conf-univ-allowance" value="${s.univAllowance || 100000}" step="10000" class="w-full p-2 rounded-lg mt-1">
                       </div>
                   </div>

                   <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <div>
                           <label class="block text-sm font-medium text-gray-300">子供の自立年齢</label>
                           <input type="number" id="conf-child-age" value="${s.childIndependenceAge}" class="w-full p-2 rounded-lg mt-1">
                       </div>
                       <div>
                           <label class="block text-sm font-medium text-gray-300">自立後の生活費削減率 (%)</label>
                           <input type="number" id="conf-reduction" value="${s.costReductionRate}" class="w-full p-2 rounded-lg mt-1">
                           <p class="text-xs text-gray-400 mt-1">※全ての子供が自立した後の基本生活費削減率</p>
                       </div>
                   </div>
               </div>

               <!-- 5. シナリオ比較 -->
               <div class="space-y-3">
                   <h4 class="font-bold text-gray-200 border-l-4 border-pink-500 pl-2">5. シナリオ比較</h4>
                   <p class="text-xs text-gray-400">現在の設定を「比較用シナリオ」として保存します。設定を変更してグラフで比較できます。</p>
                   <div class="flex gap-2">
                       <input type="text" id="scenario-name" placeholder="シナリオ名 (例: 私立プラン)" class="flex-1 p-2 rounded-lg bg-gray-800 border border-gray-600">
                       <button type="button" onclick="handleAddScenario()" class="bg-pink-600 hover:bg-pink-700 text-white px-4 rounded-lg font-bold">保存</button>
                   </div>
                   <div id="scenario-list" class="space-y-2 mt-2">
                       ${appData.scenarios && appData.scenarios.length > 0 ? appData.scenarios.map(sc => `
                           <div class="flex justify-between items-center bg-gray-700 p-2 rounded border border-gray-600">
                               <span class="text-sm font-bold text-pink-300">Run: ${sc.name}</span>
                               <button type="button" onclick="deleteItem('scenarios', '${sc.id}')" class="text-red-400 hover:text-red-500"><i data-lucide="x" class="w-4 h-4"></i></button>
                           </div>
                       `).join('') : '<p class="text-xs text-gray-500">保存されたシナリオはありません</p>'}
                   </div>
               </div>

               <button type="submit" class="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-bold transition duration-150">設定を保存して再計算</button>
           </form>
       </div>
`;
    return html;
};

// ヘルパー関数: 仕送り入力欄の表示切り替え
window.toggleUnivAllowance = (value) => {
    const area = document.getElementById('univ-allowance-area');
    if (area) {
        if (value === 'away') {
            area.classList.remove('hidden');
        } else {
            area.classList.add('hidden');
        }
    }
};

// --- 残高入力画面のレンダリング ---
const renderBalanceInput = (container) => {
    const today = new Date();
    const defaultMonth = formatDateToYM(today);

    // 選択された月に対応する既存の残高データを検索
    const getBalanceDataForMonth = (month) => {
        return appData.monthlyBalances.find(item => item.month === month);
    };

    // 初期表示時に使用するデータ（最新の実績月 or 今月）
    const initialBalanceData = getBalanceDataForMonth(defaultMonth);
    let initialTotal = initialBalanceData ? initialBalanceData.total : 0; // 既存データがあればその合計値、なければ 0

    // 口座入力フィールドのHTMLを生成
    let accountInputs = appData.accounts.map(acc => {
        // 既存のデータがあればその口座の値を、なければ0を初期値として使用
        // valueに空文字が入ると、Number(input.value)がNaNになる可能性があるため、0を明示的に設定
        const initialValue = initialBalanceData ? (initialBalanceData.accounts[acc.id] || 0) : 0;

        return `
            <div class="mb-3">
                <label for="balance-${acc.id}" class="block text-sm font-medium mb-1">${acc.name} の残高 (JPY)</label>
                <input type="number" id="balance-${acc.id}" data-id="${acc.id}" placeholder="金額を入力" value="${initialValue}" required
                    class="w-full p-2 rounded-lg balance-input">
            </div>
    `;
    }).join('');

    let historyList = appData.monthlyBalances.sort((a, b) => b.month.localeCompare(a.month)).map(item => `
        <li class="flex justify-between items-center bg-gray-700 p-3 rounded-lg text-sm">
            <span class="font-semibold">${item.month}</span>
            <span class="${item.total < 0 ? 'text-red-400' : 'text-green-400'} font-bold">${formatCurrency(item.total)}</span>
            <button onclick="deleteItem('monthlyBalances', '${item.month}', true)" class="text-red-400 hover:text-red-500 p-1">
                <i data-lucide="trash-2" class="w-5 h-5"></i>
            </button>
        </li >
    `).join('');

    container.innerHTML = `
    <h2 class="text-2xl font-bold mb-4"> 月次総残高入力</h2 >
        <p class="mb-4 text-gray-400">最新の実績残高を記録することで、予測の精度が向上します。</p>

        <div class="card mb-6">
            ${appData.accounts.length === 0 ? `
                <p class="text-center text-red-400 mb-3">⚠️ まず「設定・登録」で口座を登録してください。</p>
                <button onclick="navigate('settings')" class="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold">設定画面へ</button>
            ` : `
                <form id="balance-input-form" class="space-y-3">
                    <label for="balance-month" class="block text-sm font-medium mb-1">入力月</label>
                    <input type="month" id="balance-month" value="${defaultMonth}" required
                        class="w-full p-2 rounded-lg">

                    <div id="account-inputs" class="space-y-3 mt-4">
                        ${accountInputs}
                    </div>

                    <div class="text-lg font-bold pt-3 border-t border-gray-700 flex justify-between">
                        <span>合計残高 (自動計算):</span>
                        <span id="current-total-balance" class="${initialTotal < 0 ? 'text-red-400' : 'text-green-400'} font-bold">${formatCurrency(initialTotal)}</span>
                    </div>

                    <button type="submit" class="w-full py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition duration-150">残高を登録・更新</button>
                </form>
            `}
        </div>

        <h3 class="text-xl font-bold mb-3">過去の入力履歴 (${appData.monthlyBalances.length}件)</h3>
        <ul class="card space-y-2 hide-scrollbar h-64 overflow-y-auto">
            ${historyList.length > 0 ? historyList : '<li class="text-gray-400 text-center py-4">履歴がありません。</li>'}
        </ul>
        <div class="h-24"></div>
`;
    // イベントリスナーの登録
    if (appData.accounts.length > 0) {
        document.getElementById('balance-input-form')?.addEventListener('submit', handleBalanceInput);
        document.querySelectorAll('.balance-input').forEach(input => {
            // ★修正箇所①: イベントリスナーを 'input' に変更し、リアルタイム更新
            input.addEventListener('input', updateBalanceTotal);
            // 初期表示で空文字の場合に'0'に設定する処理を、updateBalanceTotal側で対応
        });

        // ★改修箇所②: 月選択時の口座残高の反映ロジックを追加
        document.getElementById('balance-month')?.addEventListener('change', (e) => {
            const selectedMonth = e.target.value;
            const existingData = appData.monthlyBalances.find(item => item.month === selectedMonth);

            let newTotal = 0;

            document.querySelectorAll('.balance-input').forEach(input => {
                const accountId = input.dataset.id;
                let balance = 0;

                if (existingData) {
                    // 既存データがあればその値を設定
                    balance = existingData.accounts[accountId] || 0;
                }

                input.value = balance;
                newTotal += balance;
            });

            // 合計残高を更新
            updateBalanceTotal(); // 初期値渡しをやめて、DOMから再計算させる
        });

        // ★修正箇所③: 描画後に一度合計を計算し直して、DOMに反映する (特に初期値が0でない場合)
        updateBalanceTotal();
    }

    // Lucideアイコンを再描画
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
    }
};

/**
 * 口座残高入力時の合計残高をリアルタイムで更新する。
 * @param {number | null} initialTotal - 強制的に設定する初期合計値（月変更時など、現在は未使用）
 */
const updateBalanceTotal = (initialTotal = null) => {
    let total = 0;
    const accountBalances = {}; // Fix: Define accountBalances object locally

    // initialTotalが渡された場合の処理は削除し、常にDOMから計算するようにする
    // if (initialTotal !== null) {
    //     total = initialTotal;
    // } else {

    document.querySelectorAll('.balance-input').forEach(input => {
        // input.value が空文字または不正な文字列の場合、Number() は NaN を返す可能性がある
        // required属性があるため空文字は送信されないはずだが、NaN対策を強化
        const amount = Number(input.value);

        // ユーザーが入力しない場合 (空文字) は Number('') = 0 なので OK
        // ユーザーが数値以外を入力した場合 (例: "abc") は Number("abc") = NaN
        // NaN のチェックを追加
        if (isNaN(amount)) {
            allInputsValid = false;
            return;
        }

        const accountId = input.dataset.id;
        accountBalances[accountId] = amount;
        total += amount;
    });
    // } // initialTotal のブロックは削除


    const totalSpan = document.getElementById('current-total-balance');
    if (totalSpan) {
        // totalがNaNにならないことを前提に、formatCurrencyを呼び出す
        totalSpan.textContent = formatCurrency(total);
        totalSpan.classList.toggle('text-red-400', total < 0);
        totalSpan.classList.toggle('text-green-400', total >= 0);
    }
};



// --- データ管理画面のレンダリング ---
const renderDataManagementTab = (container) => {
    container.innerHTML = `
    <h2 class="text-2xl font-bold mb-4"> データ管理</h2 >
        <p class="mb-6 text-gray-400">データのバックアップ、復元、全削除を行います。</p>

        <div class="card mb-6 space-y-4">
            <h3 class="text-xl font-bold border-b border-gray-700 pb-2">データのエクスポート (JSON)</h3>
            <p class="text-sm text-gray-400">現在のデータをJSONファイルとしてダウンロードします。</p>
            <button onclick="handleExportData()" class="w-full py-2 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition duration-150 flex items-center justify-center">
                <i data-lucide="cloud-download" class="w-5 h-5 mr-2"></i> 全データをエクスポート
            </button>
        </div>

        <div class="card mb-6 space-y-4">
            <h3 class="text-xl font-bold border-b border-gray-700 pb-2">データのインポート (JSON)</h3>
            <p class="text-sm text-red-300">※インポートされたデータは現在のデータを上書きします。</p>
            <input type="file" id="import-file-input" accept="application/json" class="w-full text-sm text-gray-400
                file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100">
            <button onclick="handleImportData()" class="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold transition duration-150 flex items-center justify-center">
                <i data-lucide="cloud-upload" class="w-5 h-5 mr-2"></i> インポートを実行
            </button>
        </div>

        <div class="card space-y-4">
            <h3 class="text-xl font-bold border-b border-gray-700 pb-2 text-red-400">全データの削除</h3>
            <p class="text-sm text-red-300">この操作は元に戻せません。全ての家計データがブラウザから削除されます。</p>
            <button onclick="handleClearData()" class="w-full py-2 bg-red-600 hover:bg-red-700 rounded-lg font-semibold transition duration-150 flex items-center justify-center">
                <i data-lucide="alert-triangle" class="w-5 h-5 mr-2"></i> 全データを削除
            </button>
        </div>

        <div class="h-24"></div>
`;
    // Lucideアイコンを再描画
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
        lucide.createIcons();
    }
};

// ====================================================================
// VI. イベントハンドラ
// ====================================================================

/**
 * 新しい口座を登録する。
 */
const handleAddAccount = (e) => {
    e.preventDefault();
    const name = document.getElementById('account-name').value.trim();
    if (name) {
        appData.accounts.push({ id: generateId(), name });
        saveData();
        setSettingsTab('family-account');
        showMessage("登録完了", `${name} 口座が追加されました。`);
    }
};

/**
 * 家族情報を登録する。
 */
const handleAddFamily = (e) => {
    e.preventDefault();
    const name = document.getElementById('family-name').value.trim();
    const age = parseInt(document.getElementById('family-age').value);
    const birthMonth = parseInt(document.getElementById('family-birth-month').value);

    if (name && !isNaN(age) && !isNaN(birthMonth)) {
        appData.families.push({ id: generateId(), name, age, birthMonth });
        saveData();
        setSettingsTab('family-account');
        showMessage("登録完了", `${name} 様の家族情報が追加されました。`);
    }
};

/**
 * 定期支出を登録する。
 */
const handleAddRecurring = (e) => {
    e.preventDefault();
    const name = document.getElementById('recurring-name').value.trim();
    const amount = parseInt(document.getElementById('recurring-amount').value);
    const intervalYears = parseInt(document.getElementById('recurring-interval').value);
    const startYM = document.getElementById('recurring-start-ym').value;
    const category = document.getElementById('recurring-category').value; // 新規追加

    if (name && !isNaN(amount) && !isNaN(intervalYears) && startYM) {
        appData.recurringExpenses.push({ id: generateId(), name, amount, intervalYears, startYM, category });
        saveData();
        setSettingsTab('recurring');
        showMessage("登録完了", `${name} の定期支出が追加されました。`);
    } else {
        showMessage("入力エラー", "全ての項目を正しく入力してください。");
    }
};

const handleAddLoan = (e) => {
    e.preventDefault();
    const name = document.getElementById('loan-name').value.trim();
    const amount = parseInt(document.getElementById('loan-amount').value);
    const startYM = document.getElementById('loan-start').value;
    const endYM = document.getElementById('loan-end').value;

    if (name && !isNaN(amount) && startYM && endYM) {
        if (!appData.loans) appData.loans = [];
        appData.loans.push({ id: generateId(), name, monthlyAmount: amount, startYM, endYM });
        saveData();
        setSettingsTab('recurring');
        showMessage("登録完了", `${name} が追加されました。`);
    } else {
        showMessage("エラー", "すべての項目を入力してください。");
    }
};

/**
 * 将来イベントを登録する。
 */
const handleAddFutureEvent = (e) => {
    e.preventDefault();
    const name = document.getElementById('event-name').value.trim();
    const amount = parseInt(document.getElementById('event-amount').value);
    const familyId = document.getElementById('event-family-id').value;
    const targetAge = parseInt(document.getElementById('event-target-age').value);
    const targetMonth = parseInt(document.getElementById('event-target-month').value);

    if (name && !isNaN(amount) && familyId && !isNaN(targetAge) && !isNaN(targetMonth)) {
        appData.futureEvents.push({ id: generateId(), name, amount, familyId, targetAge, targetMonth });
        saveData();
        setSettingsTab('future-event');
        showMessage("登録完了", `${name} イベントが追加されました。`);
    }
};

/**
 * シミュレーション設定を更新する。
 */
const handleSimConfigUpdate = (e) => {
    e.preventDefault();

    // 値の取得と型変換
    const years = parseInt(document.getElementById('conf-years').value) || 30;
    // 古いIncome/Bonus入力は廃止。
    const living = parseInt(document.getElementById('conf-living').value) || 250000;
    const inflation = parseFloat(document.getElementById('conf-inflation').value) || 0;
    const salaryIncAmount = parseInt(document.getElementById('conf-salary-increase-amount').value) || 0;
    const investMonthly = parseInt(document.getElementById('conf-invest-monthly').value) || 0;
    const investYield = parseFloat(document.getElementById('conf-invest-yield').value) || 0;
    const eduMode = document.getElementById('conf-edu-mode').value;
    const licenseAge = parseInt(document.getElementById('conf-license-age').value) || 75;
    const childIndepAge = parseInt(document.getElementById('conf-child-age').value) || 23;
    const costRed = parseFloat(document.getElementById('conf-reduction').value) || 0;
    const univHousing = document.getElementById('conf-univ-housing').value;
    const univAllow = parseInt(document.getElementById('conf-univ-allowance').value) || 0;

    // 家族別収入設定の取得
    const familyIncomes = {};
    const familyDivs = document.querySelectorAll('#sim-config-form [data-family-id]');
    familyDivs.forEach(div => {
        const id = div.getAttribute('data-family-id');
        familyIncomes[id] = {
            monthly: parseInt(div.querySelector('.f-income').value) || 0,
            bonus: parseInt(div.querySelector('.f-bonus').value) || 0,
            retirementAge: parseInt(div.querySelector('.f-retire-age').value) || 60,
            severance: parseInt(div.querySelector('.f-severance').value) || 0,
            pension: parseInt(div.querySelector('.f-pension').value) || 0,
        };
    });

    // バリデーション
    if (years > 0 && years <= 50) {
        appData.settings = {
            ...appData.settings,
            predictionYears: years,
            familyIncomes: familyIncomes, // 保存
            currentLivingCost: living,
            inflationRate: inflation,
            salaryIncreaseAmount: salaryIncAmount,
            investmentMonthly: investMonthly,
            investmentYield: investYield,
            educationMode: eduMode,
            childIndependenceAge: childIndepAge,
            costReductionRate: costRed,
            licenseReturnAge: licenseAge,
            univHousingType: univHousing,
            univAllowance: univAllow
        };
        saveData();
        // 描画更新: フォームの値がリセットされないように、本当は再取得して描画すべきだが
        // ここでは単純に保存メッセージを出して、シミュレーション結果（Dashboard）を見るように促すほうがいい
        // しかし仕様上 setSettingsTab を呼んでいる
        setSettingsTab('sim-config');
        showMessage("設定更新", `シミュレーション設定を更新しました。\n家族ごとの収入プランが反映されます。`);
    } else {
        showMessage("入力エラー", `予測期間は1〜50年の間で入力してください。`);
    }
};

/**
 * 月次残高を登録・更新する。
 */
const handleBalanceInput = (e) => {
    e.preventDefault();
    const month = document.getElementById('balance-month').value;
    if (!month) {
        showMessage("エラー", "入力月を選択してください。");
        return;
    }

    let total = 0;
    const accountBalances = {};
    let allInputsValid = true;

    document.querySelectorAll('.balance-input').forEach(input => {
        // input.value が空文字または不正な文字列の場合、Number() は NaN を返す可能性がある
        // required属性があるため空文字は送信されないはずだが、NaN対策を強化
        const amount = Number(input.value);

        // ユーザーが入力しない場合 (空文字) は Number('') = 0 なので OK
        // ユーザーが数値以外を入力した場合 (例: "abc") は Number("abc") = NaN
        // NaN のチェックを追加
        if (isNaN(amount)) {
            allInputsValid = false;
            return;
        }

        const accountId = input.dataset.id;
        accountBalances[accountId] = amount;
        total += amount;
    });

    if (!allInputsValid) {
        showMessage("エラー", "残高は数値で入力してください。");
        return;
    }

    // 既存の月があれば更新、なければ追加
    const existingIndex = appData.monthlyBalances.findIndex(item => item.month === month);
    const newBalanceItem = { month, total, accounts: accountBalances };

    if (existingIndex !== -1) {
        appData.monthlyBalances[existingIndex] = newBalanceItem;
        showMessage("更新完了", `${month} の残高実績が更新されました。`);
    } else {
        appData.monthlyBalances.push(newBalanceItem);
        showMessage("登録完了", `${month} の残高実績が新規登録されました。`);
    }

    // 月次残高は常にソートして保存する
    appData.monthlyBalances.sort((a, b) => a.month.localeCompare(b.month));
    saveData();
    renderBalanceInput(document.getElementById('app-content'));
};

/**
 * 指定されたコレクションからアイテムを削除する。
 * @param {string} collection - コレクション名
 * @param {string} id - アイテムID (月次残高の場合はYYYY-MM)
 * @param {boolean} isMonth - 月次残高かどうか
 */
const deleteItem = async (collection, id, isMonth = false) => {
    const confirmed = await showMessage("削除の確認", "本当にこのデータを削除してもよろしいですか？", true);
    if (!confirmed) return;

    if (isMonth) {
        appData[collection] = appData[collection].filter(item => item.month !== id);
    } else {
        appData[collection] = appData[collection].filter(item => item.id !== id);
    }
    saveData();
    // 削除後の画面を再描画
    if (collection === 'monthlyBalances') {
        navigate('balance-input');
    } else {
        setSettingsTab(currentSettingTab);
    }
    showMessage("削除完了", "データが削除されました。");
};

/**
 * データをJSONファイルとしてエクスポートする。
 */
const handleExportData = () => {
    const dataStr = JSON.stringify(appData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const exportFileDefaultName = `FutureFlow_export_${new Date().toISOString().slice(0, 10)}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    showMessage("エクスポート完了", "データがJSONファイルとしてダウンロードされました。");
};

/**
 * JSONファイルを読み込み、データをインポートする。
 */
const handleImportData = () => {
    const input = document.getElementById('import-file-input');
    const file = input.files[0];

    if (!file) {
        showMessage("エラー", "JSONファイルを選択してください。");
        return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const importedData = JSON.parse(event.target.result);
            // 必須キーの簡易チェック
            if (importedData.accounts && importedData.families) {
                const confirmed = await showMessage("インポートの確認", "現在のデータは上書きされます。よろしいですか？", true);
                if (!confirmed) return;

                appData = { ...appData, ...importedData };
                saveData();
                navigate('dashboard');
                showMessage("インポート完了", "データが正常にインポートされました。");
            } else {
                throw new Error("JSONファイルの構造が不正です。");
            }
        } catch (e) {
            console.error("インポートエラー:", e);
            showMessage("インポート失敗", "ファイルの読み込みまたは解析に失敗しました。ファイル形式を確認してください。");
        }
    };
    reader.readAsText(file);
};

/**
 * 全データを削除する。
 */
const handleClearData = async () => {
    const confirmed = await showMessage("全データ削除の確認", "この操作は元に戻せません。全ての家計データを削除しますか？", true);
    if (!confirmed) return;

    localStorage.removeItem(APP_DATA_KEY);
    // 初期データに戻す
    appData = {
        accounts: [], families: [], recurringExpenses: [], futureEvents: [], monthlyBalances: [], settings: { predictionYears: 30 },
    };
    navigate('dashboard');
    showMessage("削除完了", "全てのデータが削除されました。");
};

// ====================================================================
// VII. アプリケーションの初期化
// ====================================================================

/**
 * 投資額の推奨値を計算して入力欄にセットする
 */
const suggestInvestment = () => {
    // 安全な投資額を計算
    // 簡易ロジック: (世帯月収 - 現在の生活費 - ローン等) * 0.5 ぐらいを提案
    let totalMonthlyIncome = 0;

    // 既存の入力値（画面上）から計算
    // Family Incomes
    const familyDivs = document.querySelectorAll('#sim-config-form [data-family-id]');
    familyDivs.forEach(div => {
        const m = parseInt(div.querySelector('.f-income').value) || 0;
        const b = parseInt(div.querySelector('.f-bonus').value) || 0;
        totalMonthlyIncome += m + (b / 12); // ボーナスも月割で加算
    });

    // Living Cost
    const living = parseInt(document.getElementById('conf-living').value) || 250000;

    // Current Loans (Registered)
    let loanTotal = 0;
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const currentYM = `${currentYear} -${String(currentMonth).padStart(2, '0')} `;

    if (appData.loans) {
        appData.loans.forEach(l => {
            if (currentYM >= l.startYM && currentYM <= l.endYM) {
                loanTotal += l.monthlyAmount;
            }
        });
    }

    const surplus = totalMonthlyIncome - living - loanTotal;
    // 余剰金の50%を提案 (マイナスなら0)
    const suggestion = Math.max(0, Math.floor((surplus * 0.5) / 1000) * 1000);

    document.getElementById('conf-invest-monthly').value = suggestion;
    showMessage("AI提案", `現在の月間収支(余剰: 約${formatCurrency(surplus)}) から、\n無理のない積立額として ${formatCurrency(suggestion)} を提案しました。`);
};

/**
 * シナリオを追加する
 */
const handleAddScenario = () => {
    const nameInput = document.getElementById('scenario-name');
    const name = nameInput.value.trim();
    if (!name) {
        showMessage("エラー", "シナリオ名を入力してください。");
        return;
    }

    // 現在の状態をDeep Copyして保存
    const snapshot = {
        id: generateId(),
        name: name,
        settings: JSON.parse(JSON.stringify(appData.settings)),
        families: JSON.parse(JSON.stringify(appData.families)),
        loans: JSON.parse(JSON.stringify(appData.loans || [])),
        recurring: JSON.parse(JSON.stringify(appData.recurringExpenses || []))
    };

    if (!appData.scenarios) appData.scenarios = [];
    appData.scenarios.push(snapshot);
    saveData();
    renderSimConfigTab(); // リスト更新
    showMessage("保存", `シナリオ「${name}」を保存しました。\nダッシュボードのグラフで比較できます。`);
};

/**
 * 生涯支出内訳円グラフを描画
 */
const renderBreakdownChart = (containerId, breakdown) => {
    if (!breakdown) return;

    const data = [
        breakdown.living,
        breakdown.education,
        breakdown.loan,
        breakdown.recurring,
        breakdown.investment
    ];

    // Chart描画
    const ctx = document.getElementById(containerId).getContext('2d');

    // 既存チャートがあれば破棄 (ID管理が難しいのでcanvas再生成アプローチ推奨だが、ここでは簡易的に)
    // ※ Chart.jsのインスタンス管理をしていないため、再描画ごとに重ねがきされる可能性がある。
    // 親コンテナの中身をクリアしてcanvasを再作成する。
    const container = document.getElementById(containerId).parentElement;
    container.innerHTML = `<canvas id="${containerId}"></canvas>`;
    const newCtx = document.getElementById(containerId).getContext('2d');

    const total = data.reduce((a, b) => a + b, 0);

    new Chart(newCtx, {
        type: 'doughnut',
        data: {
            labels: ['基本生活費', '教育費', '住宅・ローン', 'その他定期支出', '資産運用(積立)'],
            datasets: [{
                data: data,
                backgroundColor: [
                    '#ef4444', // Living (Red)
                    '#f59e0b', // Education (Orange)
                    '#3b82f6', // Loan (Blue)
                    '#10b981', // Recurring (Green)
                    '#8b5cf6'  // Invest (Purple)
                ],
                borderColor: '#1f2937',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { color: '#d1d5db', font: { size: 10 } } },
                title: {
                    display: true,
                    text: `将来の総支出内訳(総額: ${formatCurrency(total)})`,
                    color: '#fff',
                    font: { size: 14 }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const val = context.parsed;
                            const percentage = Math.round((val / total) * 100);
                            return `${context.label}: ${formatCurrency(val)} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
};

/**
 * アプリケーションの初期化処理
 */
const initializeApp = () => {
    loadData();
    navigate('dashboard');
};

// HTML読み込み完了後に初期化関数を実行
window.onload = initializeApp;

// グローバルスコープに必要な関数を公開
window.navigate = navigate;
window.setSettingsTab = setSettingsTab;
window.deleteItem = deleteItem;
window.handleExportData = handleExportData;
window.handleImportData = handleImportData;
window.handleClearData = handleClearData;
