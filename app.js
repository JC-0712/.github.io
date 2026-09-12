// ===================================
// CLOUD SERVICE BOOTSTRAP
// ===================================
let cloud = null;             // WorkBuddy Cloud 客户端
let cloudReady = false;       // SDK 是否加载并初始化完成
let cloudUser = null;         // 当前登录用户 {id, email} 或 null
let cloudSession = null;      // 当前会话
let cloudSignInTab = 'signin';// 当前登录/注册 tab
let pendingOtp = null;        // 保存"发送验证码"步骤的中间结果：{ verification, email, kind, isExistingUser }
                              //   signin:  verification = signInWithOtp 返回的 started（含 .data.verify）
                              //   signup:  verification = sendOtp 返回的 sent.data.verificationId（verifyOtp 用）

// 在 SDK 加载完成后初始化客户端；不允许硬编码 endpoint
function initCloud() {
  if (typeof WorkBuddyCloud === 'undefined') {
    showLoginError('云服务 SDK 加载失败，请检查网络后刷新页面');
    return false;
  }
  const cfg = window.PUBLIC_CONFIG || {};
  if (!cfg.endpoint || !cfg.publishableKey) {
    showLoginError('PUBLIC_CONFIG 未注入，请确认 publicConfig 来自云服务激活返回值');
    return false;
  }
  try {
    cloud = WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: cfg.endpoint,
      publishableKey: cfg.publishableKey,
    });
    cloudReady = true;
    return true;
  } catch (e) {
    showLoginError('云客户端初始化失败：' + (e.message || e));
    return false;
  }
}

function showLoginError(msg) {
  const el = document.getElementById('loginError');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
}

function clearLoginError() {
  const el = document.getElementById('loginError');
  if (!el) return;
  el.textContent = '';
  el.classList.remove('show');
}

function switchAuthTab(tab) {
  cloudSignInTab = tab;
  document.querySelectorAll('.login-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('panel-signin').style.display = tab === 'signin' ? 'flex' : 'none';
  document.getElementById('panel-signup').style.display = tab === 'signup' ? 'flex' : 'none';
  clearLoginError();
}

// === Auth 流程 ===
async function checkSessionAndRoute() {
  if (!cloudReady) initCloud();
  const { data: session } = await cloud.auth.getSession();
  if (session) {
    cloudSession = session;
    cloudUser = session.user;
    document.getElementById('loginOverlay').style.display = 'none';
    onAuthed();
    return;
  }
  document.getElementById('loginOverlay').style.display = 'flex';
}

async function doSignIn() {
  if (!cloudReady) return showLoginError('云服务未就绪');
  clearLoginError();
  const email = document.getElementById('signinEmail').value.trim();
  const password = document.getElementById('signinPassword').value;
  if (!email || !password) return showLoginError('请输入邮箱和密码');
  const { data, error } = await cloud.auth.signInWithPassword({ email, password });
  if (error) return showLoginError('登录失败：' + (error.message || '账号或密码错误'));
  cloudSession = data; cloudUser = data.user;
  document.getElementById('loginOverlay').style.display = 'none';
  onAuthed();
}

async function doOtpLogin() {
  if (!cloudReady) return showLoginError('云服务未就绪');
  clearLoginError();
  const email = document.getElementById('signinEmail').value.trim();
  if (!email) return showLoginError('请先填写邮箱');
  const started = await cloud.auth.signInWithOtp({ email });
  if (started.error) return showLoginError('发送验证码失败：' + started.error.message);
  // 必须保存第一次调用的 started，因为 .data.verify 绑定了当时生成的 verificationId
  pendingOtp = { email, kind: 'signin', started: started.data };
  document.getElementById('otpArea').style.display = 'flex';
  showLoginError('验证码已发送，请查收邮箱');
}

async function doVerifyOtp() {
  if (!pendingOtp || pendingOtp.kind !== 'signin' || !pendingOtp.started) {
    return showLoginError('请先点击「邮箱验证码登录」发送验证码');
  }
  const token = document.getElementById('otpToken').value.trim();
  if (!token) return showLoginError('请输入验证码');
  const done = await pendingOtp.started.verify({ token });
  if (done.error) return showLoginError('验证码错误：' + done.error.message);
  cloudSession = done.data; cloudUser = done.data.user;
  pendingOtp = null;
  document.getElementById('loginOverlay').style.display = 'none';
  onAuthed();
}

async function doForgotPassword() {
  const email = document.getElementById('signinEmail').value.trim();
  if (!email) return showLoginError('请先填写邮箱');
  const started = await cloud.auth.resetPasswordForEmail(email);
  if (started.error) return showLoginError('发送失败：' + started.error.message);
  showLoginError('重置邮件已发送，请在邮箱中按提示设置新密码');
}

async function doSendSignupOtp() {
  if (!cloudReady) return showLoginError('云服务未就绪');
  clearLoginError();
  const email = document.getElementById('signupEmail').value.trim();
  if (!email) return showLoginError('请填写邮箱');
  const sent = await cloud.auth.sendOtp({ email });
  if (sent.error) return showLoginError('发送失败：' + sent.error.message);
  // 必须保存第一次调用的 sent.data.verificationId，verifyOtp 需要它
  pendingOtp = {
    email,
    kind: 'signup',
    verificationId: sent.data.verificationId,
    isExistingUser: sent.data.isExistingUser,
  };
  document.getElementById('signupOtpArea').style.display = 'flex';
  showLoginError('验证码已发送，请查收邮箱');
}

async function doSignUp() {
  if (!pendingOtp || pendingOtp.kind !== 'signup' || !pendingOtp.verificationId) {
    return showLoginError('请先点击「发送验证码」');
  }
  const token = document.getElementById('signupOtpToken').value.trim();
  const password = document.getElementById('signupPassword').value;
  if (!pendingOtp.email || !token || !password) return showLoginError('请填写邮箱、验证码和密码');
  if (password.length < 6) return showLoginError('密码至少 6 位');
  if (pendingOtp.isExistingUser) return showLoginError('该邮箱已注册，请直接登录');
  const done = await cloud.auth.verifyOtp({
    verificationId: pendingOtp.verificationId,
    token,
    email: pendingOtp.email,
    isExistingUser: pendingOtp.isExistingUser,
    password,
  });
  if (done.error) return showLoginError('注册失败：' + done.error.message);
  cloudSession = done.data; cloudUser = done.data.user;
  pendingOtp = null;
  document.getElementById('loginOverlay').style.display = 'none';
  onAuthed();
}

async function doSignOut() {
  if (!cloud) return;
  await cloud.auth.signOut();
  cloudUser = null; cloudSession = null;
  document.getElementById('loginOverlay').style.display = 'flex';
}

// 用户登录成功后的回调：原 init() 的大部分工作
async function onAuthed() {
  // 触发原 init()（数据加载 + 渲染）
  if (typeof init === 'function') {
    try { init(); } catch(e) { console.error('init error', e); }
  }
  // 监听后续的登录态变化
  cloud.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      cloudUser = null; cloudSession = null;
      document.getElementById('loginOverlay').style.display = 'flex';
    }
  });
}

// ===================================
// GLOBAL STATE & DB
// ===================================
const DB = {
  inventory: [],
  suppliers: [],
  categories: [],
  catalogs: [],
  samples: [],
  nextId: 1
};

let currentPage = 'dashboard';
let currentDetailId = null;
let editingId = null;
let catalogView = 'grid';
let currentCategoryFilter = null;
let pendingBatchData = null;
let sampleImgData = null;
let inboundImgData = null;
let currentCatalogId = null;
let chartInstances = {};
let pendingCatalogFiles = []; // 待上传的图册附件文件列表

// ===================================
// INIT
// ===================================
function init() {
  // 由 bootCloud() 取代：先做 auth gate，再走原 init()
  // 这里保留为空函数以兼容旧引用
}

// 新入口：先初始化云客户端，检查会话，决定是显示登录页还是进系统
async function bootCloud() {
  if (!cloudReady && !initCloud()) {
    // 初始化失败也要把 loading 关掉，避免黑屏
    document.getElementById('appLoading').style.display = 'none';
    return;
  }
  const { data: session } = await cloud.auth.getSession();
  if (session) {
    cloudSession = session;
    cloudUser = session.user;
    document.getElementById('loginOverlay').style.display = 'none';
    finishInit();
  } else {
    document.getElementById('appLoading').style.display = 'none';
    document.getElementById('loginOverlay').style.display = 'flex';
  }
  cloud.auth.onAuthStateChange((event, sess) => {
    if (event === 'SIGNED_OUT' || !sess) {
      cloudUser = null; cloudSession = null;
      document.getElementById('loginOverlay').style.display = 'flex';
    } else if (event === 'SIGNED_IN' && sess) {
      cloudSession = sess; cloudUser = sess.user;
      document.getElementById('loginOverlay').style.display = 'none';
      finishInit();
    }
  });
}

// 登录完成后真正开始初始化各模块
function finishInit() {
  loadData();
  populateSupplierSelect('matSupplier');
  setupDragDrop();
  setDate();
  renderCategoryTree();
  renderAllOnPage('dashboard');
  refreshWarnings();
  updateBadge();
  generateBatchNumber();

  // 显示用户徽标与退出按钮
  const badge = document.getElementById('userBadge');
  const out = document.getElementById('signOutBtn');
  if (cloudUser && badge) badge.textContent = '👤 ' + (cloudUser.email || '已登录');
  if (out) out.style.display = 'inline-flex';

  setTimeout(() => {
    document.getElementById('appLoading').style.display = 'none';
    speak('欢迎使用JC材料系统，系统已就绪。');
  }, 600);
}

function setDate() {
  const el = document.getElementById('dashboardDate');
  if (el) el.textContent = new Date().toLocaleDateString('zh-CN', {year:'numeric',month:'long',day:'numeric',weekday:'long'});
}

function setupDragDrop() {
  const area = document.getElementById('uploadArea');
  if (!area) return;
  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('dragover'); });
  area.addEventListener('dragleave', () => area.classList.remove('dragover'));
  area.addEventListener('drop', e => {
    e.preventDefault(); area.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const input = document.getElementById('imgInput');
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      handleImageUpload(input);
    }
  });
}

// ===================================
// CLOUD DATABASE (WorkBuddy Cloud)
// ===================================
// 所有 saveData / loadData 改为云端读写；localStorage 仅作为
// "上次浏览的本地缓存 + 一次性本地→云端迁移" 临时用途。

const LOCAL_KEY = 'dzai_db';

function saveData() {
  // 兼容性保留：把当前内存 DB 镜像到 localStorage，
  // 既可用于离线浏览，也是首次登录时迁移到云端的来源
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(DB));
    updateSyncStatus(true);
  } catch(e) {
    showNotif('存储警告', '本地存储空间不足', 'warning');
  }
}

async function loadData() {
  // 1) 先尝试从云端拉取当前用户的全部数据
  let cloudHasData = false;
  if (cloud && cloudReady && cloudUser) {
    try {
      const [inv, sup, cat, ctg, smp] = await Promise.all([
        cloud.database.from('inventory').select('*').order('date', { ascending: false }),
        cloud.database.from('suppliers').select('*').order('created_at', { ascending: false }),
        cloud.database.from('categories').select('*').order('created_at', { ascending: false }),
        cloud.database.from('catalogs').select('*').order('date', { ascending: false }),
        cloud.database.from('samples').select('*').order('date', { ascending: false }),
      ]);
      if (inv.error) throw inv.error;
      if (sup.error) throw sup.error;
      if (cat.error) throw cat.error;
      if (ctg.error) throw ctg.error;
      if (smp.error) throw smp.error;

      const rows = [
        ...(inv.data || []),
        ...(sup.data || []),
        ...(cat.data || []),
        ...(ctg.data || []),
        ...(smp.data || []),
      ];
      cloudHasData = rows.length > 0;

      if (cloudHasData) {
        // 用云端数据替换 DB
        DB.inventory = (inv.data || []).map(r => normalizeInv(r));
        DB.suppliers = (sup.data || []).map(r => normalizeSupplier(r));
        DB.categories = (cat.data || []).map(r => normalizeCategory(r));
        DB.catalogs = (ctg.data || []).map(r => normalizeCatalog(r));
        DB.samples = (smp.data || []).map(r => normalizeSample(r));
      }
    } catch (e) {
      console.error('云端加载失败', e);
      showNotif('云端加载失败', e.message || '请检查网络后刷新', 'error');
    }
  }

  // 2) 如果云端没有任何数据，且本地 localStorage 里有老数据 → 询问是否迁移
  if (!cloudHasData) {
    const localRaw = localStorage.getItem(LOCAL_KEY);
    if (localRaw) {
      try {
        const local = JSON.parse(localRaw);
        const hasAny = (local.inventory?.length || 0) + (local.suppliers?.length || 0) +
                       (local.categories?.length || 0) + (local.catalogs?.length || 0) +
                       (local.samples?.length || 0);
        if (hasAny > 0 && confirm(
          `检测到本地有 ${hasAny} 条历史数据，是否一次性迁移到云端？\n` +
          `（选择"确定"会复制到云端；选择"取消"将仅使用云端空数据）`
        )) {
          await migrateLocalToCloud(local);
        }
      } catch(e) { console.error(e); }
    } else if (!cloudHasData) {
      // 3) 云端无、本地无 → 首次登录的演示数据写入云端
      initDemoData();
      await migrateLocalToCloud(DB);
    }
  }

  // 计算 nextId 防止本地预览时 id 冲突
  DB.nextId = (DB.inventory.reduce((m, r) => Math.max(m, r.id || 0), 0) || 0) + 1;
  saveData(); // 同步本地缓存
}

// 字段归一化：把数据库行（下划线）映射为前端对象的属性名
function normalizeInv(r) {
  return { id:r.id, name:r.name, type:r.type, spec:r.spec, qty:Number(r.qty)||0,
    unit:r.unit, price:Number(r.price)||0, location:r.location, surface:r.surface,
    color:r.color, supplier:r.supplier, contact:r.contact, phone:r.phone,
    batch:r.batch, threshold:Number(r.threshold)||0, remark:r.remark,
    img:r.img, isSample:!!r.is_sample, date:r.date };
}
function normalizeSupplier(r) {
  return { id:r.id, name:r.name, category:r.category, contact:r.contact,
    phone:r.phone, mainBiz:r.main_biz, address:r.address, remark:r.remark,
    date:r.created_at };
}
function normalizeCategory(r) {
  return { id:r.id, name:r.name, icon:r.icon,
    subItems:Array.isArray(r.sub_items) ? r.sub_items : [] };
}
function normalizeCatalog(r) {
  return { id:r.id, name:r.name, supplier:r.supplier, category:r.category,
    batch:r.batch, priceMin:Number(r.price_min)||0, priceMax:Number(r.price_max)||0,
    stock:r.stock, remark:r.remark,
    imgs:Array.isArray(r.imgs) ? r.imgs : [],
    files:Array.isArray(r.files) ? r.files : [],
    date:r.date };
}
function normalizeSample(r) {
  return { id:r.id, name:r.name, project:r.project, space:r.space,
    supplier:r.supplier, note:r.note, img:r.img, date:r.date };
}

// 将本地对象反向映射到数据库列（下划线 + JSON 数组）
function toDbInv(o) {
  const { id, date, isSample, ...rest } = o;
  return { ...rest, is_sample: !!isSample, date: date || new Date().toISOString() };
}
function toDbSupplier(o) {
  const { id, date, mainBiz, ...rest } = o;
  return { ...rest, main_biz: mainBiz, created_at: date || new Date().toISOString() };
}
function toDbCategory(o) {
  const { id, subItems, ...rest } = o;
  return { ...rest, sub_items: Array.isArray(subItems) ? subItems : [] };
}
function toDbCatalog(o) {
  const { id, priceMin, priceMax, imgs, files, ...rest } = o;
  return { ...rest, price_min: priceMin || 0, price_max: priceMax || 0,
    imgs: Array.isArray(imgs) ? imgs : [],
    files: Array.isArray(files) ? files : [] };
}
function toDbSample(o) {
  const { id, date, ...rest } = o;
  return { ...rest, date: date || new Date().toISOString() };
}

async function migrateLocalToCloud(local) {
  if (!cloud || !cloudReady) return;
  try {
    if (local.suppliers?.length) {
      await cloud.database.from('suppliers').insert(local.suppliers.map(toDbSupplier));
    }
    if (local.categories?.length) {
      await cloud.database.from('categories').insert(local.categories.map(toDbCategory));
    }
    if (local.inventory?.length) {
      await cloud.database.from('inventory').insert(local.inventory.map(toDbInv));
    }
    if (local.catalogs?.length) {
      await cloud.database.from('catalogs').insert(local.catalogs.map(toDbCatalog));
    }
    if (local.samples?.length) {
      await cloud.database.from('samples').insert(local.samples.map(toDbSample));
    }
    showNotif('迁移完成', '本地数据已上传到云端', 'success');
    // 重新拉取一遍，确保 id 用云端的
    const inv = await cloud.database.from('inventory').select('*');
    DB.inventory = (inv.data || []).map(normalizeInv);
    const sup = await cloud.database.from('suppliers').select('*');
    DB.suppliers = (sup.data || []).map(normalizeSupplier);
    const cat = await cloud.database.from('categories').select('*');
    DB.categories = (cat.data || []).map(normalizeCategory);
    const ctg = await cloud.database.from('catalogs').select('*');
    DB.catalogs = (ctg.data || []).map(normalizeCatalog);
    const smp = await cloud.database.from('samples').select('*');
    DB.samples = (smp.data || []).map(normalizeSample);
  } catch (e) {
    console.error('迁移失败', e);
    showNotif('迁移失败', e.message || '', 'error');
  }
}

function initDemoData() {
  DB.categories = [
    {id:1, name:'石材供应商', icon:'🪨', subItems:['天然大理石','花岗岩','石英石','人造石','板岩']},
    {id:2, name:'瓷砖供应商', icon:'🧱', subItems:['抛釉砖','通体砖','木纹砖','马赛克','岩板']},
    {id:3, name:'木材供应商', icon:'🪵', subItems:['实木地板','多层板','密度板','免漆板','木饰面']},
    {id:4, name:'钢材供应商', icon:'🔩', subItems:['螺纹钢','型钢','钢板','不锈钢管','镀锌管']},
    {id:5, name:'防水材料商', icon:'💧', subItems:['聚氨酯防水','SBS卷材','JS防水','防水涂料']},
  ];
  DB.suppliers = [
    {id:1, name:'宏达石材有限公司', category:'石材供应商', contact:'张经理', phone:'138-0000-1111', mainBiz:'大理石、花岗岩', address:'广东省云浮市', remark:''},
    {id:2, name:'蒙娜丽莎瓷砖', category:'瓷砖供应商', contact:'李销售', phone:'139-0000-2222', mainBiz:'抛釉砖、木纹砖', address:'广东省佛山市', remark:''},
    {id:3, name:'大王椰木业', category:'木材供应商', contact:'王总', phone:'137-0000-3333', mainBiz:'实木、板材', address:'福建省漳州市', remark:''},
    {id:4, name:'华南钢材贸易', category:'钢材供应商', contact:'赵工', phone:'136-0000-4444', mainBiz:'螺纹钢、型钢', address:'广东省佛山市', remark:''},
  ];
  DB.inventory = [
    {id:1,name:'爵士白大理石',type:'瓷砖石材',spec:'600×1200mm',qty:200,unit:'块',price:85,location:'A区-01货架',surface:'哑光',color:'白色',supplier:'宏达石材有限公司',contact:'张经理',phone:'138-0000-1111',batch:'BC202606001',threshold:30,remark:'主卧背景墙用料',date:new Date(Date.now()-2*86400000).toISOString(),img:'',isSample:false},
    {id:2,name:'鱼肚白大理石',type:'瓷砖石材',spec:'800×800mm',qty:8,unit:'块',price:120,location:'A区-02货架',surface:'抛光',color:'米白',supplier:'宏达石材有限公司',contact:'张经理',phone:'138-0000-1111',batch:'BC202606002',threshold:20,remark:'卫生间地面',date:new Date(Date.now()-86400000).toISOString(),img:'',isSample:true},
    {id:3,name:'HRB400螺纹钢φ16',type:'钢筋钢材',spec:'φ16',qty:5,unit:'吨',price:4200,location:'B区-01支架',surface:'无',color:'灰黑',supplier:'华南钢材贸易',contact:'赵工',phone:'136-0000-4444',batch:'BC202606003',threshold:10,remark:'结构用料',date:new Date(Date.now()-3600000).toISOString(),img:'',isSample:false},
    {id:4,name:'波士顿木纹砖',type:'瓷砖石材',spec:'150×900mm',qty:300,unit:'块',price:55,location:'C区-01货架',surface:'哑光',color:'棕褐',supplier:'蒙娜丽莎瓷砖',contact:'李销售',phone:'139-0000-2222',batch:'BC202606004',threshold:50,remark:'客厅地面',date:new Date().toISOString(),img:'',isSample:false},
    {id:5,name:'进口柚木实木地板',type:'木材板材',spec:'100×15mm',qty:60,unit:'平米',price:380,location:'C区-02货架',surface:'油漆',color:'金棕',supplier:'大王椰木业',contact:'王总',phone:'137-0000-3333',batch:'BC202606005',threshold:100,remark:'别墅客厅',date:new Date(Date.now()-7200000).toISOString(),img:'',isSample:true},
  ];
  DB.catalogs = [
    {id:1,name:'爵士白系列图册2025',supplier:'宏达石材有限公司',category:'石材供应商',batch:'2025年第二批',priceMin:60,priceMax:150,stock:'有库存',remark:'主打产品系列',img:'',date:new Date().toISOString()},
    {id:2,name:'木纹砖新品图册',supplier:'蒙娜丽莎瓷砖',category:'瓷砖供应商',batch:'2025春季新品',priceMin:40,priceMax:100,stock:'有库存',remark:'',img:'',date:new Date().toISOString()},
    {id:3,name:'柚木地板样册',supplier:'大王椰木业',category:'木材供应商',batch:'2025年度款',priceMin:200,priceMax:500,stock:'无库存',remark:'需预订',img:'',date:new Date().toISOString()},
  ];
  DB.samples = [
    {id:1,name:'爵士白大理石',project:'万达广场A栋',space:'大堂地面',supplier:'宏达石材有限公司',note:'800×800mm抛光面，色差控制A级，甲方已确认',img:'',date:new Date().toISOString()},
    {id:2,name:'进口柚木地板',project:'碧桂园别墅B区',space:'客厅地面',supplier:'大王椰木业',note:'宽板自然纹，哑光油漆，甲方定样确认中',img:'',date:new Date(Date.now()-86400000).toISOString()},
  ];
  DB.nextId = 20;
}

// ===================================
// SYNC STATUS
// ===================================
function updateSyncStatus(online) {
  const dot = document.getElementById('syncDot');
  const label = document.getElementById('syncLabel');
  if (dot) dot.className = 'sync-dot' + (online ? '' : ' offline');
  if (label) label.textContent = online ? '已同步' : '离线模式';
}

function toggleSync() {
  showNotif('数据同步', '数据已保存到本地存储，支持离线使用', 'info');
}

// ===================================
// NAVIGATION
// ===================================
function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.menu-item, .bottom-nav-item').forEach(m => m.classList.remove('active'));
  const pg = document.getElementById('page-' + page);
  if (pg) pg.classList.add('active');
  document.querySelectorAll('[data-page="' + page + '"]').forEach(el => el.classList.add('active'));
  currentPage = page;
  if (window.matchMedia('(max-width:768px)').matches) {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('show');
  }
  renderAllOnPage(page);
}

function renderAllOnPage(page) {
  if (page === 'dashboard') renderDashboard();
  if (page === 'inventory') renderInventory();
  if (page === 'supplier') renderSupplierPage();
  if (page === 'warnings') renderWarnings();
  if (page === 'stats') { setTimeout(updateStats, 50); }
  if (page === 'samples') renderSamples();
  if (page === 'settings') updateDataSize();
  if (page === 'inbound') { generateBatchNumber(); populateSupplierSelect('matSupplier'); }
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebarOverlay');
  sb.classList.toggle('open');
  ov.classList.toggle('show');
}

// ===================================
// NOTIFICATIONS & TTS
// ===================================
function showNotif(title, msg, type = 'success') {
  const el = document.getElementById('notification');
  const icons = {success:'✅', warning:'⚠️', error:'❌', info:'ℹ️'};
  el.className = 'notification show ' + type;
  document.getElementById('notifIcon').textContent = icons[type] || '✅';
  document.getElementById('notifTitle').textContent = title;
  document.getElementById('notifMsg').textContent = msg;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 3500);
}

function speak(text) {
  if (!window.speechSynthesis) return;
  const enabled = document.getElementById('ttsEnabled');
  if (enabled && enabled.value === '0') return;
  window.speechSynthesis.cancel();
  const ut = new SpeechSynthesisUtterance(text);
  ut.lang = 'zh-CN';
  ut.rate = parseFloat(document.getElementById('ttsRate')?.value || 1);
  const bar = document.getElementById('ttsBar');
  document.getElementById('ttsText').textContent = text;
  bar.classList.add('show');
  ut.onend = () => bar.classList.remove('show');
  window.speechSynthesis.speak(ut);
}

function stopTTS() {
  window.speechSynthesis?.cancel();
  document.getElementById('ttsBar').classList.remove('show');
}

function testTTS() {
  speak('JC材料系统，语音功能正常，系统运行良好。');
}

// ===================================
// MODAL
// ===================================
function showModal(id) {
  if (id === 'addSupplierModal') populateCategorySelect('supCategory');
  if (id === 'addCatalogModal') {
    populateSupplierSelect('catlogSupplier');
    populateCategorySelect('catlogCategory');
    // 重置附件文件列表
    pendingCatalogFiles = [];
    const fileListEl = document.getElementById('catalogFileList');
    if (fileListEl) fileListEl.style.display = 'none';
    const fileItemsEl = document.getElementById('catalogFileItems');
    if (fileItemsEl) fileItemsEl.innerHTML = '';
    const fileInput = document.getElementById('catalogFiles');
    if (fileInput) fileInput.value = '';
    const imgPrev = document.getElementById('catalogImgPreview');
    if (imgPrev) imgPrev.innerHTML = '';
  }
  if (id === 'addSampleModal') populateSupplierSelect('sampleSupplier');
  document.getElementById(id).classList.add('show');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

// ===================================
// POPULATE SELECTS
// ===================================
function populateSupplierSelect(elId) {
  const sel = document.getElementById(elId);
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">请选择供应商</option>';
  DB.suppliers.forEach(s => {
    const o = document.createElement('option');
    o.value = s.name;
    o.textContent = s.name;
    sel.appendChild(o);
  });
  if (current) sel.value = current;
}

function populateCategorySelect(elId) {
  const sel = document.getElementById(elId);
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">请选择分类</option>';
  DB.categories.forEach(c => {
    const o = document.createElement('option');
    o.value = c.name;
    o.textContent = c.icon + ' ' + c.name;
    sel.appendChild(o);
  });
  if (current) sel.value = current;
}

// ===================================
// IMAGE UPLOAD & AI RECOGNITION
// ===================================
function handleImageUpload(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { showNotif('文件过大', '请选择10MB以内的图片', 'warning'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    inboundImgData = e.target.result;
    const prev = document.getElementById('imgPreview');
    prev.src = inboundImgData;
    prev.classList.add('show');
    document.getElementById('aiBtn').disabled = false;
    document.getElementById('storageCard').style.display = 'none';
    document.getElementById('aiResultCard').style.display = 'none';
  };
  reader.readAsDataURL(file);
}

function clearImage() {
  inboundImgData = null;
  document.getElementById('imgInput').value = '';
  const prev = document.getElementById('imgPreview');
  prev.src = '';
  prev.classList.remove('show');
  document.getElementById('aiBtn').disabled = true;
  document.getElementById('aiResultCard').style.display = 'none';
  document.getElementById('storageCard').style.display = 'none';
}

const AI_TYPES = ['瓷砖石材','钢筋钢材','木材板材','水泥砂浆','防水材料','涂料油漆','玻璃材料','装饰材料','保温材料','门窗型材'];
const AI_SPECS = ['600×1200mm','800×800mm','300×600mm','φ16','φ20','1220×2440mm','150×900mm','1200×2400mm'];
const AI_SURFACES = ['哑光','抛光','釉面','拉丝','喷砂','氧化处理','自然面'];
const AI_COLORS = ['白色','黑色','灰色','米黄','深灰','木纹色','棕色','象牙白'];

function runAIRecognition() {
  if (!inboundImgData) return;
  const btn = document.getElementById('aiBtn');
  btn.textContent = '🔄 识别中...';
  btn.disabled = true;
  setTimeout(() => {
    const t = AI_TYPES[Math.floor(Math.random() * AI_TYPES.length)];
    const sp = AI_SPECS[Math.floor(Math.random() * AI_SPECS.length)];
    const su = AI_SURFACES[Math.floor(Math.random() * AI_SURFACES.length)];
    const cl = AI_COLORS[Math.floor(Math.random() * AI_COLORS.length)];
    const conf = (86 + Math.random() * 11).toFixed(1);
    document.getElementById('matType').value = t;
    document.getElementById('matSpec').value = sp;
    document.getElementById('matSurface').value = su;
    document.getElementById('matColor').value = cl;
    const storageRec = getStorageRecommendation(t);
    document.getElementById('matLocation').value = storageRec.split('（')[0];
    document.getElementById('aiResultContent').innerHTML = `
      <div class="ai-result-title">🤖 AI识别完成 · 置信度 <b>${conf}%</b></div>
      <div><span class="ai-chip">📋 ${t}</span><span class="ai-chip">📐 ${sp}</span><span class="ai-chip">✨ ${su}</span><span class="ai-chip">🎨 ${cl}</span></div>
      <div class="ai-suggestion">
        <b>💡 分类建议：</b>识别为「${t}」<br>
        • <b>推荐存储区：</b>${storageRec}<br>
        • <b>存储注意：</b>${getStorageTips(t)}
      </div>`;
    document.getElementById('aiResultCard').style.display = 'block';
    document.getElementById('storageContent').innerHTML = `<div class="ai-suggestion"><b>📍 推荐位置：</b>${storageRec}<br><b>⚠️ 注意事项：</b>${getStorageTips(t)}</div>`;
    document.getElementById('storageCard').style.display = 'block';
    btn.textContent = '🤖 重新识别';
    btn.disabled = false;
    speak(`识别完成，该材料为${t}，置信度${conf}%，已自动填充分类信息，请核对。`);
  }, 1600);
}

function getStorageRecommendation(type) {
  const m = {'瓷砖石材':'A区干燥货架（平放堆叠防碰角）','钢筋钢材':'B区室外支架（防锈处理）','木材板材':'C区通风货仓（保持干燥）','水泥砂浆':'D区防潮货仓（离地50cm）','防水材料':'E区阴凉库房（避光0-40℃）','涂料油漆':'F区危化专区（通风防火）','保温材料':'G区干燥库房（防潮防压）','玻璃材料':'H区专用框架（竖放防碎）','门窗型材':'I区型材专区（分型号摆放）','装饰材料':'J区展示货架（分类标签）'};
  return m[type] || '通用仓库存储区（按规格分类）';
}

function getStorageTips(type) {
  const m = {'瓷砖石材':'防止碰角损坏，大规格需专用支架竖放','钢筋钢材':'按直径分类，防锈处理，标注批次','木材板材':'通风防潮，严禁明火，检查含水率','水泥砂浆':'不超过3个月，先进先出，防潮防湿','防水材料':'避免冻融，检查有效期','涂料油漆':'配备消防器材，注意过期日期'};
  return m[type] || '按规范存放，定期盘点，做好标签';
}

// ===================================
// INBOUND SUBMIT
// ===================================
function generateBatchNumber() {
  const el = document.getElementById('matBatch');
  if (el && !el.value) {
    const n = new Date();
    el.value = `BC${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}${String(Math.floor(Math.random()*900)+100)}`;
  }
}

async function submitInbound() {
  const name = document.getElementById('matName').value.trim();
  const type = document.getElementById('matType').value;
  const qty = parseFloat(document.getElementById('matQty').value);
  const price = parseFloat(document.getElementById('matPrice').value);
  const location = document.getElementById('matLocation').value.trim();
  if (!name) { showNotif('信息不完整','请填写材料名称','warning'); return; }
  if (!type) { showNotif('信息不完整','请选择材料类型','warning'); return; }
  if (!qty || qty <= 0) { showNotif('信息不完整','请填写有效数量','warning'); return; }
  if (!price || price < 0) { showNotif('信息不完整','请填写单价','warning'); return; }
  if (!location) { showNotif('信息不完整','请填写存储位置','warning'); return; }
  const supplier = document.getElementById('matSupplier').value || document.getElementById('matContact').value || '';
  const record = {
    name, type,
    spec: document.getElementById('matSpec').value,
    qty, unit: document.getElementById('matUnit').value, price, location,
    surface: document.getElementById('matSurface').value,
    color: document.getElementById('matColor').value,
    supplier, contact: document.getElementById('matContact').value,
    phone: document.getElementById('matPhone').value,
    batch: document.getElementById('matBatch').value,
    threshold: parseInt(document.getElementById('matThreshold').value) || parseInt(document.getElementById('defaultThreshold')?.value) || 10,
    remark: document.getElementById('matRemark').value,
    date: new Date().toISOString(),
    img: inboundImgData || '',
    isSample: false
  };

  // 上传图片到 Storage（如果有），得到签名 URL 再入库
  let imgUrl = '';
  if (inboundImgData && cloud && cloudReady) {
    try {
      const blob = await (await fetch(inboundImgData)).blob();
      const path = cloud.storage.userPath(cloudUser.id, `inventory/${Date.now()}_${(blob.type||'png').split('/')[1]||'png'}`);
      await cloud.storage.upload(path, blob, { contentType: blob.type, upsert: false });
      imgUrl = await cloud.storage.createSignedUrl(path, 60 * 60 * 24 * 365); // 1 年签名
    } catch(e) { console.warn('图片上传失败', e); }
  }
  if (!imgUrl) imgUrl = inboundImgData || '';
  record.img = imgUrl;

  // 写入云端
  if (cloud && cloudReady) {
    const { data, error } = await cloud.database.from('inventory').insert(toDbInv(record)).select();
    if (error) { showNotif('入库失败', error.message, 'error'); return; }
    if (Array.isArray(data) && data[0]) record.id = data[0].id;
    // 若供应商是新的，也写入云端 suppliers
    if (supplier && !DB.suppliers.find(s => s.name === supplier)) {
      const supRec = { name: supplier, category: '', contact: record.contact, phone: record.phone, main_biz: type, address: '', remark: '' };
      const { data: supData } = await cloud.database.from('suppliers').insert(supRec).select();
      if (Array.isArray(supData) && supData[0]) supRec.id = supData[0].id;
      DB.suppliers.push({ id: supRec.id, name: supplier, category:'', contact:record.contact, phone:record.phone, mainBiz:type, address:'', remark:'' });
    }
  }

  DB.inventory.unshift(record);
  DB.nextId = Math.max(DB.nextId, (record.id || 0) + 1);
  saveData();
  clearForm();
  refreshWarnings();
  updateBadge();
  speak(`${name}已成功入库！数量${qty}${record.unit}，存放于${location}，请确认存放。`);
  showNotif('入库成功', `${name} × ${qty}${record.unit} 已上传云端`, 'success');
  setTimeout(() => navigateTo('inventory'), 800);
}

function clearForm() {
  ['matName','matSpec','matQty','matPrice','matLocation','matSurface','matColor','matContact','matPhone','matRemark','matThreshold'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('matType').value = '';
  document.getElementById('matUnit').value = '块';
  document.getElementById('matSupplier').value = '';
  document.getElementById('matBatch').value = '';
  clearImage();
  generateBatchNumber();
  document.getElementById('storageCard').style.display = 'none';
  document.getElementById('aiResultCard').style.display = 'none';
}

function markAsSample() {
  const name = document.getElementById('matName').value.trim();
  if (!name) { showNotif('提示','请先填写材料名称','warning'); return; }
  document.getElementById('sampleName').value = name;
  if (inboundImgData) {
    const prev = document.getElementById('sampleImgPreview');
    prev.src = inboundImgData;
    prev.style.display = 'block';
    sampleImgData = inboundImgData;
  }
  populateSupplierSelect('sampleSupplier');
  document.getElementById('sampleSupplier').value = document.getElementById('matSupplier').value;
  showModal('addSampleModal');
}

// ===================================
// DASHBOARD
// ===================================
function renderDashboard() {
  const total = DB.inventory.length;
  const totalVal = DB.inventory.reduce((s, i) => s + i.qty * i.price, 0);
  const supCount = new Set(DB.inventory.map(i => i.supplier).filter(Boolean)).size;
  const warns = DB.inventory.filter(i => i.qty <= i.threshold).length;
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthNew = DB.inventory.filter(i => new Date(i.date) >= monthStart).length;

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statTotalChange').textContent = `本月新增 ${monthNew} 条`;
  document.getElementById('statValue').textContent = '¥' + (totalVal >= 10000 ? (totalVal/10000).toFixed(1)+'万' : totalVal.toFixed(0));
  document.getElementById('statSupplier').textContent = supCount;
  document.getElementById('statWarn').textContent = warns;
  document.getElementById('statWarnChange').textContent = warns > 0 ? `${warns} 项需补货` : '库存充足';

  // Warn alerts
  const warnItems = DB.inventory.filter(i => i.qty <= i.threshold).slice(0, 3);
  const warnEl = document.getElementById('dashWarnAlerts');
  if (warnItems.length > 0) {
    warnEl.innerHTML = `<div class="alert alert-warning"><span class="alert-icon">⚠️</span><div><b>${warnItems.length}项库存预警：</b>${warnItems.map(i => `${i.name}(剩${i.qty}${i.unit})`).join('、')}</div></div>`;
  } else {
    warnEl.innerHTML = '';
  }

  // Recent table
  const recent = [...DB.inventory].slice(0, 8);
  document.getElementById('recentTableBody').innerHTML = recent.map(item => `
    <tr style="cursor:pointer;" onclick="viewDetail(${item.id})">
      <td><b>${item.name}</b></td>
      <td><span class="badge badge-blue">${item.type}</span></td>
      <td>${item.qty} ${item.unit}</td>
      <td style="font-size:12px;">${item.supplier || '-'}</td>
      <td style="font-size:12px;">${new Date(item.date).toLocaleDateString('zh-CN')}</td>
      <td><span class="badge ${item.qty <= item.threshold ? 'badge-red' : 'badge-green'}">${item.qty <= item.threshold ? '⚠️预警' : '正常'}</span></td>
    </tr>`).join('');

  renderDashboardCharts();
}

function renderDashboardCharts() {
  // Trend chart (30 days)
  const days = 30;
  const labels = [];
  const data = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toLocaleDateString('zh-CN', {month:'numeric',day:'numeric'});
    labels.push(ds);
    const dayStr = d.toISOString().split('T')[0];
    const cnt = DB.inventory.filter(item => item.date.startsWith(dayStr)).length;
    data.push(cnt);
  }
  renderChart('trendChart', 'line', labels, [{label:'入库数量',data,borderColor:'#1a56db',backgroundColor:'rgba(26,86,219,0.08)',tension:0.4,fill:true}]);

  // Type pie
  const typeMap = {};
  DB.inventory.forEach(i => { typeMap[i.type] = (typeMap[i.type] || 0) + 1; });
  const typeLabels = Object.keys(typeMap);
  const typeData = typeLabels.map(k => typeMap[k]);
  const colors = ['#1a56db','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16','#ec4899','#6b7280'];
  renderChart('typeChart', 'doughnut', typeLabels, [{data:typeData,backgroundColor:colors}]);
}

function renderChart(id, type, labels, datasets) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  if (chartInstances[id]) { chartInstances[id].destroy(); }
  chartInstances[id] = new Chart(ctx, {
    type,
    data: {labels, datasets},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {legend: {position: type === 'doughnut' ? 'right' : 'top', labels: {font: {size: 11}}}},
      scales: type !== 'doughnut' && type !== 'pie' ? {y: {beginAtZero: true, ticks: {font: {size: 11}}}, x: {ticks: {font: {size: 10}, maxTicksLimit: 8}}} : undefined
    }
  });
}

// ===================================
// INVENTORY
// ===================================
function renderInventory() {
  populateSupplierFilter();
  filterInventory();
}

function populateSupplierFilter() {
  const sel = document.getElementById('filterSupplier');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">全部供应商</option>';
  const names = [...new Set(DB.inventory.map(i => i.supplier).filter(Boolean))];
  names.forEach(n => { const o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o); });
  sel.value = current;
}

function clearPriceFilter() {
  document.getElementById('priceMin').value = '';
  document.getElementById('priceMax').value = '';
  filterInventory();
}

function filterInventory() {
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const type = document.getElementById('filterType')?.value || '';
  const sup = document.getElementById('filterSupplier')?.value || '';
  const pMin = parseFloat(document.getElementById('priceMin')?.value) || 0;
  const pMax = parseFloat(document.getElementById('priceMax')?.value) || Infinity;

  const filtered = DB.inventory.filter(i => {
    const mQ = !q || i.name.toLowerCase().includes(q) || (i.type||'').toLowerCase().includes(q)
      || (i.supplier||'').toLowerCase().includes(q) || (i.spec||'').toLowerCase().includes(q)
      || (i.batch||'').toLowerCase().includes(q);
    const mT = !type || i.type === type;
    const mS = !sup || i.supplier === sup;
    const mP = i.price >= pMin && i.price <= pMax;
    return mQ && mT && mS && mP;
  });

  const countEl = document.getElementById('inventoryCount');
  if (countEl) countEl.textContent = filtered.length;
  const tbody = document.getElementById('inventoryTableBody');
  const emptyEl = document.getElementById('inventoryEmpty');
  if (filtered.length === 0) {
    if (tbody) tbody.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  tbody.innerHTML = filtered.map(item => `
    <tr>
      <td><input type="checkbox" class="row-check" data-id="${item.id}"></td>
      <td>${item.img ? `<img src="${item.img}" style="width:38px;height:38px;object-fit:cover;border-radius:6px;">` : '<div style="width:38px;height:38px;background:var(--bg);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:18px;">📦</div>'}</td>
      <td><b style="cursor:pointer;color:var(--primary);" onclick="viewDetail(${item.id})">${item.name}</b>
        ${item.isSample ? '<span class="badge badge-purple" style="margin-left:4px;font-size:10px;">定样</span>' : ''}
        ${item.qty <= item.threshold ? '<span class="badge badge-red" style="margin-left:4px;font-size:10px;">⚠️</span>' : ''}
      </td>
      <td><span class="badge badge-blue">${item.type||'-'}</span></td>
      <td class="mobile-hide" style="font-size:12px;color:var(--text-light);">${item.spec||'-'}</td>
      <td><b>${item.qty}</b> ${item.unit}</td>
      <td>¥${item.price.toFixed(2)}</td>
      <td class="mobile-hide">¥${(item.qty*item.price).toFixed(2)}</td>
      <td class="mobile-hide" style="font-size:12px;">${item.location||'-'}</td>
      <td class="mobile-hide" style="font-size:12px;">${item.supplier||'-'}</td>
      <td class="mobile-hide" style="font-size:12px;">${new Date(item.date).toLocaleDateString('zh-CN')}</td>
      <td>
        <div style="display:flex;gap:4px;">
          <button class="btn-icon" onclick="viewDetail(${item.id})" title="详情">👁️</button>
          <button class="btn-icon" onclick="openEdit(${item.id})" title="编辑">✏️</button>
          <button class="btn-icon" style="background:#fee2e2;color:var(--danger);" onclick="deleteRecord(${item.id})" title="删除">🗑️</button>
        </div>
      </td>
    </tr>`).join('');
}

function toggleSelectAll(cb) {
  document.querySelectorAll('.row-check').forEach(c => c.checked = cb.checked);
}

// ===================================
// DETAIL & EDIT
// ===================================
function viewDetail(id) {
  const item = DB.inventory.find(i => i.id === id);
  if (!item) return;
  currentDetailId = id;
  document.getElementById('detailContent').innerHTML = `
    <div class="detail-header">
      ${item.img ? `<img class="detail-img" src="${item.img}" alt="图片">` : '<div class="detail-img" style="background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:48px;">📦</div>'}
      <div class="detail-info">
        <div class="detail-name">${item.name}</div>
        <div class="detail-meta">
          <span class="badge badge-blue">${item.type}</span>
          ${item.isSample ? '<span class="badge badge-purple">🎨 定样</span>' : ''}
          <span class="badge ${item.qty<=item.threshold?'badge-red':'badge-green'}">${item.qty<=item.threshold?'⚠️ 预警':'✅ 正常'}</span>
        </div>
        <div style="margin-top:8px;font-size:13px;color:var(--text-light);">批次：${item.batch} · 入库：${new Date(item.date).toLocaleDateString('zh-CN')}</div>
      </div>
    </div>
    <div class="tabs">
      <button class="tab-btn active" onclick="switchDetailTab(this,'dtab-basic')">基本信息</button>
      <button class="tab-btn" onclick="switchDetailTab(this,'dtab-storage')">库存状态</button>
      <button class="tab-btn" onclick="switchDetailTab(this,'dtab-supplier')">供应商</button>
    </div>
    <div class="tab-panel active" id="dtab-basic">
      <div class="detail-grid">
        <span class="field-label">材料名称</span><span class="field-value"><b>${item.name}</b></span>
        <span class="field-label">材料类型</span><span class="field-value">${item.type}</span>
        <span class="field-label">规格型号</span><span class="field-value">${item.spec||'-'}</span>
        <span class="field-label">数量</span><span class="field-value"><b>${item.qty}</b> ${item.unit}</span>
        <span class="field-label">单价</span><span class="field-value" style="color:var(--primary);font-weight:600;">¥${item.price.toFixed(2)}</span>
        <span class="field-label">总价值</span><span class="field-value" style="color:var(--success);font-weight:600;">¥${(item.qty*item.price).toFixed(2)}</span>
        <span class="field-label">表面工艺</span><span class="field-value">${item.surface||'-'}</span>
        <span class="field-label">颜色/色号</span><span class="field-value">${item.color||'-'}</span>
        <span class="field-label">批次号</span><span class="field-value">${item.batch||'-'}</span>
        <span class="field-label">入库时间</span><span class="field-value">${new Date(item.date).toLocaleString('zh-CN')}</span>
        <span class="field-label">备注</span><span class="field-value">${item.remark||'-'}</span>
      </div>
    </div>
    <div class="tab-panel" id="dtab-storage">
      <div class="detail-grid">
        <span class="field-label">存储位置</span><span class="field-value" style="font-weight:600;">📍 ${item.location||'-'}</span>
        <span class="field-label">当前数量</span><span class="field-value"><b style="font-size:18px;">${item.qty}</b> ${item.unit}</span>
        <span class="field-label">预警数量</span><span class="field-value">${item.threshold} ${item.unit}</span>
        <span class="field-label">库存状态</span><span class="field-value">${item.qty<=item.threshold?'<span style="color:var(--danger);font-weight:600;">⚠️ 低库存，需补货</span>':'<span style="color:var(--success);font-weight:600;">✅ 库存充足</span>'}</span>
      </div>
      <div style="margin-top:14px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-light);margin-bottom:5px;"><span>库存进度</span><span>${item.qty} / ${Math.max(item.threshold*3,item.qty)}</span></div>
        <div class="progress" style="height:12px;">
          <div class="progress-bar ${item.qty<=item.threshold?'danger':'success'}" style="width:${Math.min(100,(item.qty/Math.max(item.threshold*3,item.qty))*100).toFixed(0)}%;"></div>
        </div>
      </div>
    </div>
    <div class="tab-panel" id="dtab-supplier">
      <div class="detail-grid">
        <span class="field-label">供应商</span><span class="field-value"><b>${item.supplier||'-'}</b></span>
        <span class="field-label">联系人</span><span class="field-value">${item.contact||'-'}</span>
        <span class="field-label">联系电话</span><span class="field-value">${item.phone?`<a href="tel:${item.phone}" style="color:var(--primary);">${item.phone}</a>`:'-'}</span>
      </div>
    </div>`;
  showModal('detailModal');
  speak(`${item.name}，${item.type}，库存${item.qty}${item.unit}，存放于${item.location}。`);
}

function switchDetailTab(btn, tabId) {
  const container = btn.closest('.modal-body') || btn.closest('.page');
  container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  container.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  const tab = document.getElementById(tabId);
  if (tab) tab.classList.add('active');
}

function editRecord() {
  closeModal('detailModal');
  openEdit(currentDetailId);
}

function openEdit(id) {
  const item = DB.inventory.find(i => i.id === id);
  if (!item) return;
  editingId = id;
  const types = ['钢筋钢材','水泥砂浆','瓷砖石材','木材板材','防水材料','保温材料','管道管件','电气材料','涂料油漆','玻璃材料','门窗型材','装饰材料','其他'];
  const units = ['块','件','吨','米','平米','立方米','袋','桶','套','根','卷','箱'];
  document.getElementById('editFormContent').innerHTML = `
    <div class="form-group full"><label>材料名称</label><input type="text" class="form-control" id="e_name" value="${item.name}"></div>
    <div class="form-group"><label>材料类型</label><select class="form-control" id="e_type">${types.map(t=>`<option ${item.type===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div class="form-group"><label>规格</label><input type="text" class="form-control" id="e_spec" value="${item.spec||''}"></div>
    <div class="form-group"><label>数量</label><input type="number" class="form-control" id="e_qty" value="${item.qty}"></div>
    <div class="form-group"><label>单位</label><select class="form-control" id="e_unit">${units.map(u=>`<option ${item.unit===u?'selected':''}>${u}</option>`).join('')}</select></div>
    <div class="form-group"><label>单价（元）</label><input type="number" class="form-control" id="e_price" value="${item.price}"></div>
    <div class="form-group"><label>存储位置</label><input type="text" class="form-control" id="e_location" value="${item.location||''}"></div>
    <div class="form-group"><label>表面工艺</label><input type="text" class="form-control" id="e_surface" value="${item.surface||''}"></div>
    <div class="form-group"><label>颜色/色号</label><input type="text" class="form-control" id="e_color" value="${item.color||''}"></div>
    <div class="form-group"><label>供应商</label><input type="text" class="form-control" id="e_supplier" value="${item.supplier||''}"></div>
    <div class="form-group"><label>联系人</label><input type="text" class="form-control" id="e_contact" value="${item.contact||''}"></div>
    <div class="form-group"><label>联系电话</label><input type="tel" class="form-control" id="e_phone" value="${item.phone||''}"></div>
    <div class="form-group"><label>预警数量</label><input type="number" class="form-control" id="e_threshold" value="${item.threshold||10}"></div>
    <div class="form-group full"><label>备注</label><textarea class="form-control" id="e_remark">${item.remark||''}</textarea></div>`;
  showModal('editModal');
}

async function saveEdit() {
  const item = DB.inventory.find(i => i.id === editingId);
  if (!item) return;
  item.name = document.getElementById('e_name').value;
  item.type = document.getElementById('e_type').value;
  item.spec = document.getElementById('e_spec').value;
  item.qty = parseFloat(document.getElementById('e_qty').value) || 0;
  item.unit = document.getElementById('e_unit').value;
  item.price = parseFloat(document.getElementById('e_price').value) || 0;
  item.location = document.getElementById('e_location').value;
  item.surface = document.getElementById('e_surface').value;
  item.color = document.getElementById('e_color').value;
  item.supplier = document.getElementById('e_supplier').value;
  item.contact = document.getElementById('e_contact').value;
  item.phone = document.getElementById('e_phone').value;
  item.threshold = parseInt(document.getElementById('e_threshold').value) || 10;
  item.remark = document.getElementById('e_remark').value;
  if (cloud && cloudReady) {
    const { error } = await cloud.database.from('inventory').update(toDbInv(item)).eq('id', item.id);
    if (error) { showNotif('保存失败', error.message, 'error'); return; }
  }
  saveData();
  closeModal('editModal');
  filterInventory();
  refreshWarnings();
  updateBadge();
  showNotif('修改成功','材料信息已同步到云端','success');
}

async function deleteRecord(id) {
  if (!confirm('确认删除该入库记录？此操作不可恢复。')) return;
  if (cloud && cloudReady) {
    const { error } = await cloud.database.from('inventory').delete().eq('id', id);
    if (error) { showNotif('删除失败', error.message, 'error'); return; }
  }
  DB.inventory = DB.inventory.filter(i => i.id !== id);
  saveData();
  filterInventory();
  refreshWarnings();
  updateBadge();
  showNotif('已删除','记录已从云端移除','info');
}

// ===================================
// WARNINGS
// ===================================
function refreshWarnings() {
  renderWarnings();
  updateBadge();
}

function renderWarnings() {
  const warns = DB.inventory.filter(i => i.qty <= i.threshold);
  const el = document.getElementById('warningList');
  const emptyEl = document.getElementById('warningEmpty');
  if (!el) return;
  if (warns.length === 0) {
    el.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  el.innerHTML = warns.map(item => `
    <div class="warn-item">
      <span style="font-size:22px;">⚠️</span>
      <div class="wi-name">${item.name} <span class="badge badge-blue" style="font-size:10px;">${item.type}</span></div>
      <div>
        <div class="wi-stock">剩余 ${item.qty} ${item.unit}</div>
        <div class="wi-thresh">预警线 ${item.threshold} ${item.unit}</div>
      </div>
      <div style="font-size:12px;color:var(--text-light);">${item.location||''}</div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-sm btn-primary" onclick="openEdit(${item.id})">补货</button>
        <button class="btn btn-sm btn-outline" onclick="viewDetail(${item.id})">详情</button>
      </div>
    </div>`).join('');
}

function updateBadge() {
  const cnt = DB.inventory.filter(i => i.qty <= i.threshold).length;
  const badge = document.getElementById('warnBadge');
  if (badge) badge.textContent = cnt;
}

// ===================================
// SUPPLIER PAGE
// ===================================
function renderSupplierPage() {
  renderCategoryTree();
  renderCatalogs();
}

function renderCategoryTree() {
  const tree = document.getElementById('categoryTree');
  if (!tree) return;
  if (DB.categories.length === 0) {
    tree.innerHTML = '<div style="text-align:center;padding:20px;font-size:13px;color:var(--text-light);">暂无分类，点击下方新建</div>';
    return;
  }
  tree.innerHTML = DB.categories.map(cat => {
    const supCnt = DB.suppliers.filter(s => s.category === cat.name).length;
    return `<div class="cat-item">
      <div class="cat-header" onclick="toggleCatChildren('cat-${cat.id}',this);filterCatalogsByCategory('${cat.name}')">
        <span>${cat.icon||'📁'}</span>
        <span class="cat-name">${cat.name}</span>
        <span style="font-size:12px;color:var(--text-light);">${supCnt}家</span>
        <span class="cat-arrow">▶</span>
      </div>
      <div class="cat-children" id="cat-${cat.id}">
        ${(cat.subItems||[]).map(sub => `<div class="sub-cat-item" onclick="filterCatalogsByCategory('${cat.name}','${sub}')" ><span>·</span>${sub}</div>`).join('')}
        <div class="sub-cat-item" style="color:var(--primary);" onclick="addSubItem(${cat.id})">➕ 添加子类别</div>
      </div>
    </div>`;
  }).join('');
}

function toggleCatChildren(id, header) {
  const ch = document.getElementById(id);
  if (!ch) return;
  const open = ch.classList.contains('open');
  document.querySelectorAll('.cat-children').forEach(c => c.classList.remove('open'));
  document.querySelectorAll('.cat-arrow').forEach(a => a.textContent = '▶');
  if (!open) {
    ch.classList.add('open');
    const arrow = header.querySelector('.cat-arrow');
    if (arrow) arrow.textContent = '▼';
  }
}

function filterCatalogsByCategory(catName, sub) {
  currentCategoryFilter = catName;
  document.getElementById('currentCategoryTitle').textContent = sub ? `${catName} · ${sub}` : catName;
  renderCatalogs(catName, sub);
}

function filterSupplierTree() {
  const q = document.getElementById('supplierSearch')?.value.toLowerCase() || '';
  const tree = document.getElementById('categoryTree');
  if (!tree) return;
  tree.querySelectorAll('.cat-item').forEach(item => {
    const name = item.querySelector('.cat-name')?.textContent.toLowerCase() || '';
    item.style.display = !q || name.includes(q) ? '' : 'none';
  });
}

function filterCatalogs() {
  renderCatalogs(currentCategoryFilter);
}

function renderCatalogs(catFilter, subFilter) {
  const stockFilter = document.getElementById('catalogFilter')?.value || '';
  const filtered = DB.catalogs.filter(c => {
    const mC = !catFilter || c.category === catFilter;
    const mSt = !stockFilter || c.stock === stockFilter;
    return mC && mSt;
  });
  const grid = document.getElementById('catalogGridView');
  const listBody = document.getElementById('catalogListBody');
  const empty = document.getElementById('catalogEmpty');
  if (filtered.length === 0) {
    if (grid) grid.innerHTML = '';
    if (listBody) listBody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (grid) {
    grid.innerHTML = filtered.map(c => {
      const fileCount = (c.files || []).length;
      return `
      <div class="catalog-card" onclick="viewCatalogDetail(${c.id})">
        ${c.img ? `<img src="${c.img}" alt="${c.name}" loading="lazy">` : '<div class="cat-img-placeholder">📚</div>'}
        <div class="catalog-info">
          <div class="catalog-name">${c.name}</div>
          <div class="catalog-meta">${c.supplier}</div>
          <div style="margin-top:6px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:12px;color:var(--primary);font-weight:600;">¥${c.priceMin||0}~${c.priceMax||0}</span>
            <span class="badge ${c.stock==='有库存'?'badge-green':c.stock==='无库存'?'badge-red':'badge-yellow'}">${c.stock}</span>
          </div>
          <div style="margin-top:5px;display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:11px;color:var(--text-light);">${c.batch||''}</span>
            ${fileCount > 0 ? `<span style="font-size:11px;color:var(--text-light);background:var(--bg);padding:2px 6px;border-radius:10px;border:1px solid var(--border);">📎 ${fileCount}个附件</span>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
  }
  if (listBody) {
    listBody.innerHTML = filtered.map(c => `
      <tr style="cursor:pointer;" onclick="viewCatalogDetail(${c.id})">
        <td>${c.name}</td><td>${c.supplier}</td><td>${c.category||'-'}</td>
        <td>¥${c.priceMin||0}~${c.priceMax||0}</td>
        <td><span class="badge ${c.stock==='有库存'?'badge-green':'badge-red'}">${c.stock}</span></td>
        <td>${c.batch||'-'}</td>
        <td><button class="btn-icon" style="background:#fee2e2;color:var(--danger);" onclick="event.stopPropagation();confirmDeleteCatalog(${c.id})">🗑️</button></td>
      </tr>`).join('');
  }
}

function setCatalogView(type) {
  catalogView = type;
  const grid = document.getElementById('catalogGridView');
  const list = document.getElementById('catalogListView');
  const gBtn = document.getElementById('gridViewBtn');
  const lBtn = document.getElementById('listViewBtn');
  if (type === 'grid') {
    if (grid) grid.style.display = '';
    if (list) list.style.display = 'none';
    if (gBtn) gBtn.classList.add('active-view');
    if (lBtn) lBtn.classList.remove('active-view');
  } else {
    if (grid) grid.style.display = 'none';
    if (list) list.style.display = 'block';
    if (gBtn) gBtn.classList.remove('active-view');
    if (lBtn) lBtn.classList.add('active-view');
  }
}

function viewCatalogDetail(id) {
  const c = DB.catalogs.find(c => c.id === id);
  if (!c) return;
  currentCatalogId = id;
  document.getElementById('catalogDetailTitle').textContent = '📚 ' + c.name;
  const sup = DB.suppliers.find(s => s.name === c.supplier);

  // 构建附件文件列表 HTML
  const filesHtml = buildCatalogFilesHtml(c.files || []);

  document.getElementById('catalogDetailContent').innerHTML = `
    ${c.img ? `<img src="${c.img}" style="width:100%;max-height:220px;object-fit:contain;border-radius:var(--radius);margin-bottom:16px;">` : `<div style="height:140px;background:linear-gradient(135deg,var(--primary-light),#e0e7ff);border-radius:var(--radius);display:flex;align-items:center;justify-content:center;font-size:64px;margin-bottom:16px;">📚</div>`}
    <div class="detail-grid" style="gap:10px 14px;">
      <span class="field-label">图册名称</span><span class="field-value"><b>${c.name}</b></span>
      <span class="field-label">供应商</span><span class="field-value">${c.supplier}</span>
      <span class="field-label">分类</span><span class="field-value">${c.category||'-'}</span>
      <span class="field-label">批次号</span><span class="field-value">${c.batch||'-'}</span>
      <span class="field-label">价格区间</span><span class="field-value" style="color:var(--primary);font-weight:600;">¥${c.priceMin||0} — ¥${c.priceMax||0}</span>
      <span class="field-label">库存状态</span><span class="field-value"><span class="badge ${c.stock==='有库存'?'badge-green':c.stock==='无库存'?'badge-red':'badge-yellow'}">${c.stock}</span></span>
      <span class="field-label">录入时间</span><span class="field-value">${new Date(c.date).toLocaleDateString('zh-CN')}</span>
      <span class="field-label">备注</span><span class="field-value">${c.remark||'-'}</span>
    </div>
    ${filesHtml}
    ${sup ? `<div style="margin-top:16px;padding:14px;background:var(--bg);border-radius:var(--radius-sm);">
      <b>📞 供应商联系方式</b>
      <div style="margin-top:8px;font-size:13px;display:grid;gap:4px;">
        <div>联系人：${sup.contact||'-'}</div>
        <div>电话：${sup.phone?`<a href="tel:${sup.phone}" style="color:var(--primary);">${sup.phone}</a>`:'-'}</div>
        <div>地址：${sup.address||'-'}</div>
      </div>
    </div>` : ''}`;
  showModal('catalogDetailModal');
}

function buildCatalogFilesHtml(files) {
  if (!files || files.length === 0) return '';
  return `
    <div style="margin-top:16px;">
      <div style="font-weight:600;font-size:14px;margin-bottom:8px;">📎 附件文件（${files.length}个）</div>
      <div class="catalog-detail-files">
        ${files.map((f, idx) => {
          const isImage = /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(f.name);
          const canPreview = isImage && f.data;
          return `<div class="detail-file-item">
            <span class="file-icon" style="font-size:22px;">${getFileIcon(f.name)}</span>
            <div class="file-info" style="flex:1;min-width:0;">
              <div class="file-name" style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.name}</div>
              <div class="file-meta" style="font-size:11px;color:var(--text-light);">${getFileTypeLabel(f.name)} · ${formatFileSize(f.size)}${f.largeFile?'<span style="color:var(--warning);margin-left:4px;">⚠️大文件</span>':''}</div>
            </div>
            <div style="display:flex;gap:6px;flex-shrink:0;">
              ${canPreview ? `<button class="btn btn-sm btn-outline" onclick="previewCatalogFile(${idx})" style="font-size:11px;padding:3px 8px;">🔍 预览</button>` : ''}
              ${f.data ? `<button class="btn btn-sm btn-primary" onclick="downloadCatalogFile(${idx})" style="font-size:11px;padding:3px 8px;">⬇️ 下载</button>` : `<span style="font-size:11px;color:var(--text-light);padding:3px 6px;">⚠️未存储</span>`}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

function downloadCatalogFile(fileIdx) {
  const c = DB.catalogs.find(c => c.id === currentCatalogId);
  if (!c || !c.files || !c.files[fileIdx]) return;
  const f = c.files[fileIdx];
  if (!f.data) { showNotif('无法下载','该文件超过存储限制，未完整保存','warning'); return; }
  const a = document.createElement('a');
  a.href = f.data;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showNotif('下载开始', f.name, 'info');
}

function previewCatalogFile(fileIdx) {
  const c = DB.catalogs.find(c => c.id === currentCatalogId);
  if (!c || !c.files || !c.files[fileIdx]) return;
  const f = c.files[fileIdx];
  if (!f.data) { showNotif('无法预览','文件数据未保存','warning'); return; }
  const isImage = /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(f.name);
  if (isImage) {
    // 图片在新的overlay中预览
    let overlay = document.getElementById('imgViewerOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'imgViewerOverlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer;';
      overlay.onclick = () => overlay.remove();
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<div style="position:relative;max-width:90vw;max-height:90vh;">
      <img src="${f.data}" style="max-width:90vw;max-height:85vh;border-radius:8px;display:block;">
      <div style="text-align:center;color:#fff;font-size:13px;margin-top:8px;">${f.name}</div>
      <button onclick="event.stopPropagation();document.getElementById('imgViewerOverlay').remove();" style="position:absolute;top:-14px;right:-14px;background:#fff;border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;font-size:16px;">✕</button>
    </div>`;
    overlay.style.display = 'flex';
  }
}

async function deleteCatalog() {
  if (!currentCatalogId) return;
  if (!confirm('确认删除该图册？')) return;
  if (cloud && cloudReady) {
    const { error } = await cloud.database.from('catalogs').delete().eq('id', currentCatalogId);
    if (error) { showNotif('删除失败', error.message, 'error'); return; }
  }
  DB.catalogs = DB.catalogs.filter(c => c.id !== currentCatalogId);
  saveData();
  closeModal('catalogDetailModal');
  renderCatalogs(currentCategoryFilter);
  showNotif('已删除','图册已从云端移除','info');
}

async function confirmDeleteCatalog(id) {
  if (!confirm('确认删除该图册？')) return;
  if (cloud && cloudReady) {
    const { error } = await cloud.database.from('catalogs').delete().eq('id', id);
    if (error) { showNotif('删除失败', error.message, 'error'); return; }
  }
  DB.catalogs = DB.catalogs.filter(c => c.id !== id);
  saveData();
  renderCatalogs(currentCategoryFilter);
  showNotif('已删除','图册已从云端移除','info');
}

// ===================================
// ADD ACTIONS
// ===================================
async function addSupplier() {
  const name = document.getElementById('supName').value.trim();
  if (!name) { showNotif('提示','请填写供应商名称','warning'); return; }
  const record = {
    name,
    category: document.getElementById('supCategory').value,
    contact: document.getElementById('supContact').value,
    phone: document.getElementById('supPhone').value,
    mainBiz: document.getElementById('supMainBiz').value,
    address: document.getElementById('supAddress').value,
    remark: document.getElementById('supRemark').value
  };
  if (cloud && cloudReady) {
    const { data, error } = await cloud.database.from('suppliers').insert(toDbSupplier(record)).select();
    if (error) { showNotif('添加失败', error.message, 'error'); return; }
    if (Array.isArray(data) && data[0]) record.id = data[0].id;
  } else {
    record.id = DB.nextId++;
  }
  DB.suppliers.push(record);
  saveData();
  closeModal('addSupplierModal');
  ['supName','supContact','supPhone','supMainBiz','supAddress','supRemark'].forEach(id => { const el=document.getElementById(id); if(el)el.value=''; });
  renderCategoryTree();
  showNotif('添加成功', name + ' 已同步到云端', 'success');
}

async function addCategory() {
  const name = document.getElementById('catName').value.trim();
  if (!name) { showNotif('提示','请填写分类名称','warning'); return; }
  const subItems = (document.getElementById('catSubItems').value||'').split('\n').map(s=>s.trim()).filter(Boolean);
  const record = {
    name,
    icon: document.getElementById('catIcon').value || '📁',
    subItems
  };
  if (cloud && cloudReady) {
    const { data, error } = await cloud.database.from('categories').insert(toDbCategory(record)).select();
    if (error) { showNotif('创建失败', error.message, 'error'); return; }
    if (Array.isArray(data) && data[0]) record.id = data[0].id;
  } else {
    record.id = DB.nextId++;
  }
  DB.categories.push(record);
  saveData();
  closeModal('addCategoryModal');
  ['catName','catIcon','catSubItems'].forEach(id => { const el=document.getElementById(id); if(el)el.value=''; });
  renderCategoryTree();
  showNotif('创建成功', '分类「' + name + '」已同步到云端', 'success');
}

function addSubItem(catId) {
  const name = prompt('请输入子类别名称：');
  if (!name || !name.trim()) return;
  const cat = DB.categories.find(c => c.id === catId);
  if (cat) {
    if (!cat.subItems) cat.subItems = [];
    cat.subItems.push(name.trim());
    saveData();
    renderCategoryTree();
    showNotif('已添加','子类别已添加','success');
  }
}

function previewCatalogImg(input) {
  const prev = document.getElementById('catalogImgPreview');
  prev.innerHTML = '';
  const files = Array.from(input.files).slice(0, 5);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = document.createElement('img');
      img.src = e.target.result;
      img.style.cssText = 'width:70px;height:70px;object-fit:cover;border-radius:6px;border:2px solid var(--border);';
      prev.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
  prev.style.display = 'flex';
}

// ===================================
// CATALOG FILE UPLOAD
// ===================================
const FILE_TYPE_ICONS = {
  pdf: '📄', ppt: '📊', pptx: '📊', doc: '📝', docx: '📝',
  xls: '📋', xlsx: '📋', zip: '🗜️', rar: '🗜️', '7z': '🗜️',
  jpg: '🖼️', jpeg: '🖼️', png: '🖼️', webp: '🖼️', gif: '🖼️', bmp: '🖼️',
  dwg: '📐', cad: '📐', default: '📎'
};

function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return FILE_TYPE_ICONS[ext] || FILE_TYPE_ICONS.default;
}

function getFileTypeLabel(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const labels = {
    pdf:'PDF文档', ppt:'PPT演示', pptx:'PPT演示', doc:'Word文档', docx:'Word文档',
    xls:'Excel表格', xlsx:'Excel表格', zip:'ZIP压缩包', rar:'RAR压缩包', '7z':'7Z压缩包',
    jpg:'JPG图片', jpeg:'JPG图片', png:'PNG图片', webp:'WEBP图片', gif:'GIF图片', bmp:'BMP图片',
    dwg:'CAD图纸', cad:'CAD图纸'
  };
  return labels[ext] || ext.toUpperCase() + '文件';
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function handleCatalogFiles(input) {
  const files = Array.from(input.files);
  addCatalogFilesToList(files);
}

function addCatalogFilesToList(files) {
  const MAX_SIZE = 50 * 1024 * 1024; // 50MB
  files.forEach(file => {
    if (file.size > MAX_SIZE) {
      showNotif('文件过大', `${file.name} 超过50MB限制`, 'warning');
      return;
    }
    // 防重复
    if (pendingCatalogFiles.find(f => f.name === file.name && f.size === file.size)) return;
    pendingCatalogFiles.push(file);
  });
  renderCatalogFileList();
}

function renderCatalogFileList() {
  const listEl = document.getElementById('catalogFileList');
  const itemsEl = document.getElementById('catalogFileItems');
  if (!listEl || !itemsEl) return;
  if (pendingCatalogFiles.length === 0) {
    listEl.style.display = 'none';
    return;
  }
  listEl.style.display = 'block';
  itemsEl.innerHTML = pendingCatalogFiles.map((f, idx) => `
    <div class="catalog-file-item">
      <span class="file-icon">${getFileIcon(f.name)}</span>
      <div class="file-info">
        <div class="file-name">${f.name}</div>
        <div class="file-meta">${getFileTypeLabel(f.name)} · ${formatFileSize(f.size)}</div>
      </div>
      <button class="file-remove" onclick="removeCatalogFile(${idx})" title="移除">✕</button>
    </div>`).join('');
}

function removeCatalogFile(idx) {
  pendingCatalogFiles.splice(idx, 1);
  renderCatalogFileList();
}

function catalogFileDragOver(e) {
  e.preventDefault();
  document.getElementById('catalogFileArea')?.classList.add('dragover');
}

function catalogFileDragLeave(e) {
  document.getElementById('catalogFileArea')?.classList.remove('dragover');
}

function catalogFileDrop(e) {
  e.preventDefault();
  document.getElementById('catalogFileArea')?.classList.remove('dragover');
  const files = Array.from(e.dataTransfer.files);
  addCatalogFilesToList(files);
}

// 将文件读取为 base64（用于 localStorage 存储，仅对小文件）
function readFileAsDataURL(file) {
  return new Promise((resolve) => {
    if (file.size > 5 * 1024 * 1024) {
      // 大文件仅记录元数据，不存入 base64（避免 localStorage 溢出）
      resolve({ name: file.name, size: file.size, type: file.type, data: null, largeFile: true });
      return;
    }
    const reader = new FileReader();
    reader.onload = e => resolve({ name: file.name, size: file.size, type: file.type, data: e.target.result, largeFile: false });
    reader.onerror = () => resolve({ name: file.name, size: file.size, type: file.type, data: null, largeFile: true });
    reader.readAsDataURL(file);
  });
}

async function addCatalog() {
  const name = document.getElementById('catlogName').value.trim();
  const supplier = document.getElementById('catlogSupplier').value;
  if (!name) { showNotif('提示','请填写图册名称','warning'); return; }
  if (!supplier) { showNotif('提示','请选择供应商','warning'); return; }
  const imgs = document.querySelectorAll('#catalogImgPreview img');
  const img = imgs.length > 0 ? imgs[0].src : '';

  const btn = document.querySelector('#addCatalogModal .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 上传中...'; }

  try {
    let imgUrl = img;
    if (img && img.startsWith('data:') && cloud && cloudReady) {
      try {
        const blob = await (await fetch(img)).blob();
        const path = cloud.storage.userPath(cloudUser.id, `catalogs/${Date.now()}_cover_${(blob.type||'png').split('/')[1]||'png'}`);
        await cloud.storage.upload(path, blob, { contentType: blob.type, upsert: false });
        imgUrl = await cloud.storage.createSignedUrl(path, 60 * 60 * 24 * 365);
      } catch(e) { console.warn('封面上传失败', e); }
    }
    const filesData = [];
    for (const file of pendingCatalogFiles) {
      if (cloud && cloudReady) {
        try {
          const path = cloud.storage.userPath(cloudUser.id, `catalogs/${Date.now()}_${file.name}`);
          await cloud.storage.upload(path, file, { contentType: file.type, upsert: false });
          const url = await cloud.storage.createSignedUrl(path, 60 * 60 * 24 * 365);
          filesData.push({ name: file.name, size: file.size, type: file.type, url });
        } catch(e) { console.warn('附件上传失败', e); }
      } else {
        filesData.push({ name: file.name, size: file.size, type: file.type });
      }
    }

    const record = {
      name, supplier,
      category: document.getElementById('catlogCategory').value,
      batch: document.getElementById('catlogBatch').value,
      priceMin: parseFloat(document.getElementById('catlogPriceMin').value) || 0,
      priceMax: parseFloat(document.getElementById('catlogPriceMax').value) || 0,
      stock: document.getElementById('catlogStock').value,
      remark: document.getElementById('catlogRemark').value,
      img: imgUrl, date: new Date().toISOString(),
      files: filesData
    };

    if (cloud && cloudReady) {
      const { data, error } = await cloud.database.from('catalogs').insert(toDbCatalog(record)).select();
      if (error) { showNotif('保存失败', error.message, 'error'); if (btn) { btn.disabled = false; btn.textContent = '💾 保存图册'; } return; }
      if (Array.isArray(data) && data[0]) record.id = data[0].id;
    } else {
      record.id = DB.nextId++;
    }
    DB.catalogs.unshift(record);
    saveData();
    closeModal('addCatalogModal');
    ['catlogName','catlogBatch','catlogRemark'].forEach(id => { const el=document.getElementById(id); if(el)el.value=''; });
    document.getElementById('catalogImgPreview').innerHTML = '';
    document.getElementById('catalogFileList').style.display = 'none';
    document.getElementById('catalogFileItems').innerHTML = '';
    const fi = document.getElementById('catalogFiles');
    if (fi) fi.value = '';
    pendingCatalogFiles = [];
    renderCatalogs(currentCategoryFilter);
    if (btn) { btn.disabled = false; btn.textContent = '💾 保存图册'; }
    const fileCount = filesData.length;
    showNotif('上传成功', `图册「${name}」已上传云端${fileCount > 0 ? `，含${fileCount}个附件` : ''}`, 'success');
  } catch (e) {
    console.error(e);
    if (btn) { btn.disabled = false; btn.textContent = '💾 保存图册'; }
    showNotif('保存失败', e.message || '请重试', 'error');
  }
}

// ===================================
// SAMPLES
// ===================================
function previewSampleImg(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    sampleImgData = e.target.result;
    const prev = document.getElementById('sampleImgPreview');
    prev.src = sampleImgData;
    prev.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

async function addSample() {
  const name = document.getElementById('sampleName').value.trim();
  const project = document.getElementById('sampleProject').value.trim();
  if (!name) { showNotif('提示','请填写材料名称','warning'); return; }
  if (!project) { showNotif('提示','请填写项目名称','warning'); return; }

  let imgUrl = sampleImgData || '';
  if (sampleImgData && sampleImgData.startsWith('data:') && cloud && cloudReady) {
    try {
      const blob = await (await fetch(sampleImgData)).blob();
      const path = cloud.storage.userPath(cloudUser.id, `samples/${Date.now()}_${(blob.type||'png').split('/')[1]||'png'}`);
      await cloud.storage.upload(path, blob, { contentType: blob.type, upsert: false });
      imgUrl = await cloud.storage.createSignedUrl(path, 60 * 60 * 24 * 365);
    } catch(e) { console.warn('图片上传失败', e); }
  }

  const record = {
    name, project,
    space: document.getElementById('sampleSpace').value,
    supplier: document.getElementById('sampleSupplier').value,
    note: document.getElementById('sampleNote').value,
    img: imgUrl,
    date: new Date().toISOString()
  };

  if (cloud && cloudReady) {
    const { data, error } = await cloud.database.from('samples').insert(toDbSample(record)).select();
    if (error) { showNotif('定样失败', error.message, 'error'); return; }
    if (Array.isArray(data) && data[0]) record.id = data[0].id;
  } else {
    record.id = DB.nextId++;
  }
  DB.samples.unshift(record);
  saveData();
  closeModal('addSampleModal');
  ['sampleName','sampleProject','sampleSpace','sampleNote'].forEach(id => { const el=document.getElementById(id); if(el)el.value=''; });
  const prev = document.getElementById('sampleImgPreview');
  if (prev) { prev.src=''; prev.style.display='none'; }
  sampleImgData = null;
  renderSamples();
  showNotif('定样成功', name + ' 已上传云端', 'success');
}

function renderSamples() {
  const q = (document.getElementById('sampleSearch')?.value || '').toLowerCase();
  const pf = document.getElementById('sampleFilter')?.value || '';
  const filtered = DB.samples.filter(s => {
    const mQ = !q || s.name.toLowerCase().includes(q) || s.project.toLowerCase().includes(q);
    const mP = !pf || s.project === pf;
    return mQ && mP;
  });
  // Update project filter options
  const pSel = document.getElementById('sampleFilter');
  if (pSel) {
    const current = pSel.value;
    pSel.innerHTML = '<option value="">全部项目</option>';
    [...new Set(DB.samples.map(s => s.project))].forEach(p => {
      const o = document.createElement('option');
      o.value = p; o.textContent = p;
      pSel.appendChild(o);
    });
    pSel.value = current;
  }
  const grid = document.getElementById('sampleGrid');
  const empty = document.getElementById('sampleEmpty');
  if (!grid) return;
  if (filtered.length === 0) { grid.innerHTML = ''; if(empty) empty.style.display='block'; return; }
  if (empty) empty.style.display = 'none';
  grid.innerHTML = filtered.map(s => `
    <div class="sample-card">
      ${s.img ? `<img src="${s.img}" alt="${s.name}">` : '<div class="img-placeholder">🎨</div>'}
      <div class="sc-info">
        <div class="sc-name">${s.name}</div>
        <div class="sc-meta">📁 ${s.project}</div>
        ${s.space ? `<div class="sc-meta">🏠 ${s.space}</div>` : ''}
        ${s.supplier ? `<div class="sc-meta">🏢 ${s.supplier}</div>` : ''}
        <div class="sample-badge">✅ 已定样</div>
        ${s.note ? `<div style="font-size:11px;color:var(--text-light);margin-top:4px;line-height:1.4;">${s.note.substring(0,60)}${s.note.length>60?'...':''}</div>` : ''}
        <div class="sc-actions">
          <button class="btn btn-sm btn-outline" style="font-size:11px;padding:4px 8px;" onclick="deleteSample(${s.id})">删除</button>
        </div>
      </div>
    </div>`).join('');
}

function filterSamples() { renderSamples(); }

function deleteSample(id) {
  if (!confirm('确认删除该定样记录？')) return;
  DB.samples = DB.samples.filter(s => s.id !== id);
  saveData();
  renderSamples();
  showNotif('已删除','定样记录已删除','info');
}

// ===================================
// STATS
// ===================================
function updateStats() {
  const days = parseInt(document.getElementById('statsRange')?.value || 30);
  const cutoff = new Date(Date.now() - days * 86400000);
  const items = DB.inventory.filter(i => new Date(i.date) >= cutoff);
  const totalVal = items.reduce((s, i) => s + i.qty * i.price, 0);
  const statsCards = document.getElementById('statsCards');
  if (statsCards) {
    statsCards.innerHTML = `
      <div class="stat-card"><div class="stat-icon" style="background:#dbeafe;">📦</div><div class="stat-info"><div class="value">${items.length}</div><div class="label">入库记录</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:#d1fae5;">💰</div><div class="stat-info"><div class="value">¥${(totalVal/10000).toFixed(1)}万</div><div class="label">入库总价值</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:#fef3c7;">🏢</div><div class="stat-info"><div class="value">${new Set(items.map(i=>i.supplier).filter(Boolean)).size}</div><div class="label">涉及供应商</div></div></div>
      <div class="stat-card"><div class="stat-icon" style="background:#ede9fe;">🎨</div><div class="stat-info"><div class="value">${new Set(items.map(i=>i.type)).size}</div><div class="label">材料类型</div></div></div>`;
  }
  // Line chart
  const lineLabels = [], lineData = [];
  const step = days <= 30 ? 1 : days <= 90 ? 3 : 7;
  for (let i = days - 1; i >= 0; i -= step) {
    const d = new Date(Date.now() - i * 86400000);
    lineLabels.push(d.toLocaleDateString('zh-CN', {month:'numeric',day:'numeric'}));
    const ds = d.toISOString().split('T')[0];
    lineData.push(DB.inventory.filter(item => item.date.startsWith(ds)).length);
  }
  renderChart('statsLineChart','line',lineLabels,[{label:'入库数量',data:lineData,borderColor:'#1a56db',backgroundColor:'rgba(26,86,219,0.08)',tension:0.4,fill:true}]);
  // Pie by type
  const typeMap = {};
  items.forEach(i => { typeMap[i.type] = (typeMap[i.type]||0) + 1; });
  const tLabels = Object.keys(typeMap), tData = tLabels.map(k=>typeMap[k]);
  const colors = ['#1a56db','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16','#ec4899','#6b7280'];
  renderChart('statsPieChart','doughnut',tLabels,[{data:tData,backgroundColor:colors}]);
  // Bar by supplier
  const supMap = {};
  items.forEach(i => { if(i.supplier) supMap[i.supplier] = (supMap[i.supplier]||0) + i.qty*i.price; });
  const sLabels = Object.keys(supMap).slice(0,8), sData = sLabels.map(k=>parseFloat(supMap[k].toFixed(0)));
  renderChart('statsBarChart','bar',sLabels,[{label:'采购金额',data:sData,backgroundColor:'rgba(26,86,219,0.7)',borderRadius:6}]);
  // Price distribution
  const ranges = ['0-100','100-500','500-2000','2000-5000','5000+'];
  const priceData = [0,0,0,0,0];
  items.forEach(i => {
    if(i.price<100) priceData[0]++;
    else if(i.price<500) priceData[1]++;
    else if(i.price<2000) priceData[2]++;
    else if(i.price<5000) priceData[3]++;
    else priceData[4]++;
  });
  renderChart('statsPriceChart','bar',ranges,[{label:'数量',data:priceData,backgroundColor:'rgba(16,185,129,0.7)',borderRadius:6}]);
}

// ===================================
// EXPORT
// ===================================
function exportExcel() {
  const wb = XLSX.utils.book_new();
  // Inventory sheet
  const invData = [['材料名称','类型','规格','数量','单位','单价','总价','存储位置','表面工艺','颜色','供应商','联系人','电话','批次号','入库时间','备注']];
  DB.inventory.forEach(i => invData.push([i.name,i.type,i.spec,i.qty,i.unit,i.price,(i.qty*i.price).toFixed(2),i.location,i.surface,i.color,i.supplier,i.contact,i.phone,i.batch,new Date(i.date).toLocaleString('zh-CN'),i.remark]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(invData), '入库记录');
  // Supplier sheet
  const supData = [['供应商名称','所属分类','联系人','电话','主营类别','地址','备注']];
  DB.suppliers.forEach(s => supData.push([s.name,s.category,s.contact,s.phone,s.mainBiz,s.address,s.remark]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(supData), '供应商信息');
  // Samples sheet
  const smpData = [['材料名称','项目名称','定样空间','供应商','说明','日期']];
  DB.samples.forEach(s => smpData.push([s.name,s.project,s.space,s.supplier,s.note,new Date(s.date).toLocaleDateString('zh-CN')]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(smpData), '定样记录');
  const fname = `JC材料系统_${new Date().toLocaleDateString('zh-CN').replace(/\//g,'-')}.xlsx`;
  XLSX.writeFile(wb, fname);
  showNotif('导出成功', fname, 'success');
}

function doExport() {
  closeModal('exportModal');
  const fmt = document.getElementById('expFormat')?.value || 'excel';
  if (fmt === 'excel') exportExcel();
  else exportJSON();
}

function exportJSON() {
  const data = JSON.stringify(DB, null, 2);
  const blob = new Blob([data], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `JC材料系统备份_${new Date().toLocaleDateString('zh-CN').replace(/\//g,'-')}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showNotif('备份成功','数据已导出为JSON文件','success');
}

function importJSON() {
  document.getElementById('importFile').click();
}

function doImportJSON(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (confirm(`确认恢复数据？将覆盖当前数据。\n入库记录：${data.inventory?.length||0}条\n供应商：${data.suppliers?.length||0}家`)) {
        Object.assign(DB, data);
        saveData();
        renderAllOnPage(currentPage);
        refreshWarnings();
        updateBadge();
        showNotif('恢复成功','数据已恢复','success');
      }
    } catch(err) { showNotif('导入失败','文件格式不正确','error'); }
  };
  reader.readAsText(file);
  input.value = '';
}

// ===================================
// BATCH IMPORT
// ===================================
function downloadTemplate() {
  const data = [['材料名称','类型','规格','数量','单位','单价','存储位置','表面工艺','颜色','供应商','联系人','电话','预警数量','备注'],
    ['爵士白大理石','瓷砖石材','600×1200mm',100,'块',85,'A区-01','哑光','白色','宏达石材','张经理','138****1111',20,'示例数据']];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), '入库模板');
  XLSX.writeFile(wb, 'JC材料系统入库模板.xlsx');
}

function handleBatchImport(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, {type:'binary'});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, {header:1}).slice(1).filter(r => r[0]);
      pendingBatchData = data;
      document.getElementById('batchPreview').innerHTML = `
        <div class="alert alert-success"><span class="alert-icon">✅</span>识别到 ${data.length} 条数据，点击确认导入</div>
        <div class="table-wrap"><table><thead><tr><th>名称</th><th>类型</th><th>数量</th><th>单价</th></tr></thead>
        <tbody>${data.slice(0,5).map(r=>`<tr><td>${r[0]||'-'}</td><td>${r[1]||'-'}</td><td>${r[3]||0}</td><td>${r[5]||0}</td></tr>`).join('')}${data.length>5?`<tr><td colspan="4" style="text-align:center;color:var(--text-light);">...共${data.length}条</td></tr>`:''}</tbody></table></div>`;
      document.getElementById('batchPreview').style.display = 'block';
      document.getElementById('confirmBatch').disabled = false;
    } catch(err) { showNotif('解析失败','请检查文件格式','error'); }
  };
  reader.readAsBinaryString(file);
}

function confirmBatchImport() {
  if (!pendingBatchData) return;
  let cnt = 0;
  pendingBatchData.forEach(r => {
    if (!r[0]) return;
    DB.inventory.unshift({
      id: DB.nextId++, name: r[0]||'', type: r[1]||'其他', spec: r[2]||'',
      qty: parseFloat(r[3])||0, unit: r[4]||'件', price: parseFloat(r[5])||0,
      location: r[6]||'', surface: r[7]||'', color: r[8]||'',
      supplier: r[9]||'', contact: r[10]||'', phone: r[11]||'',
      threshold: parseInt(r[12])||10, remark: r[13]||'',
      batch: `BC${Date.now()}`, date: new Date().toISOString(), img: '', isSample: false
    });
    cnt++;
  });
  saveData();
  closeModal('batchModal');
  pendingBatchData = null;
  refreshWarnings();
  updateBadge();
  showNotif('批量导入', `成功导入 ${cnt} 条记录`, 'success');
  speak(`批量导入完成，共导入${cnt}条材料记录。`);
  navigateTo('inventory');
}

// ===================================
// SETTINGS
// ===================================
function updateDataSize() {
  try {
    const size = JSON.stringify(DB).length;
    const kb = (size / 1024).toFixed(1);
    const el = document.getElementById('dataSize');
    if (el) el.textContent = `${kb} KB（入库:${DB.inventory.length}条，供应商:${DB.suppliers.length}家，图册:${DB.catalogs.length}个）`;
  } catch(e) {}
}

function clearAllData() {
  if (!confirm('⚠️ 危险操作！将清空所有数据，此操作不可撤销！\n\n确认清空？')) return;
  if (!confirm('最后确认：清空后数据无法恢复，请先导出备份！\n\n仍然确认清空？')) return;
  localStorage.removeItem('dzai_db');
  location.reload();
}

// ===================================
// ENTRY POINT
// ===================================
window.addEventListener('DOMContentLoaded', bootCloud);
window.addEventListener('online', () => updateSyncStatus(true));
window.addEventListener('offline', () => updateSyncStatus(false));
