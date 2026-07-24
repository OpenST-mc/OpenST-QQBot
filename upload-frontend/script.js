/**
 * OpenST 上传前端脚本
 * 独立于 bot 运行，部署在 Vercel
 * 从 URL 读取 token + api 参数，提交到 bot 后端 API
 */

// 标签配置，与 bot 端 upload/config.ts 保持同步
var TAG_CONFIG = {
  '非编码存储科技': {
    '全物品单片': ['8箱单片', '10箱单片', '其他单片'],
    '大宗仓库': ['分类打包大宗', '盒分大宗', '四边形大宗'],
    '不可堆叠相关': ['不可堆叠分离', '不可堆叠分类'],
    '多物品相关': ['多物品分类 (MIS)', '多种类潜影盒分类 (MBS)']
  },
  '潜影盒处理': {
    '潜影盒打包机': [
      '分类打包', '混杂打包', '自适应打包', '精密打包',
      '缓存打包', '可访问打包', '比例打包', '堆分打包'
    ],
    '潜影盒拆包机': ['漏斗拆包', '矿车拆包 (Yeeter)', '烧包机'],
    '潜影盒展示': [
      '无残留展示', '自出盒展示', '常用物品展示', '可反悔展示',
      '上行展示', '精密展示', '细雪展示', '灵魂沙展示', '堆肥桶展示'
    ],
    '潜影盒分类相关': [
      '潜影盒分类', '自适应潜影盒分类 (SVAR)',
      '车头及拐弯设计 (Keygen & U-turn)'
    ],
    '分盒器相关': ['潜影盒分盒器', '理想分盒器 (矿车)'],
    '合并器相关': [
      '潜影盒合并器', '不满盒临时存储', '分组器 (Grouper)', '配对优化器'
    ],
    '潜影盒填充度分类': [],
    '空盒仓库': []
  },
  '编码存储科技': {
    '编码全物品单片': ['常规编码单片', '矩阵编码单片', '高速编码单片', '其他编码单片'],
    '编码大宗仓库': ['编码大宗', '编码四边形大宗', '远程大宗'],
    '逻辑/传输': ['逻辑电路', '移位寄存器', '转码器'],
    '编码器': ['二进制', '其他编码器'],
    '解码器': ['二进制', '十进制', '十六进制',
      '强模 (HSS/OSS)', '水道速', '方块事件深度(BED)'],
    '其他组件': []
  },
  '其他杂物': {
    '仓库成品': ['全物品仓库', '多物品仓库', '编码全物品'],
    '进阶组件': ['潜影盒UI', '潜影盒硬盘', '动态大宗'],
    '整流器': ['盒流整流器', '堆分整流器', '矿车整流器'],
    '分流器/黑白名单': [],
    '堆分离/分类': [],
    '无实体输入': [],
    '水道相关': [],
    '地狱门加载器': []
  },
  '生产/合成': ['合成站', '合成器相关'],
  '版本': ['1.21.x', '1.20.x', '1.19+', '1.17+', '1.16+']
};

/** API 基础地址，从 URL 参数读取 */
var API_BASE = '';

/** 上传令牌，从 URL 参数读取 */
var TOKEN = '';

/** 父子标签映射 */
var tagParents = {};

// 初始化
(function init() {
  var params = new URLSearchParams(window.location.search);
  TOKEN = params.get('token') || '';
  API_BASE = params.get('api') || '';

  if (!TOKEN) {
    document.getElementById('noToken').style.display = 'block';
    return;
  }

  document.getElementById('formSection').style.display = 'block';
  document.getElementById('tokenField').value = TOKEN;

  buildTagParents();
  renderTags();
  bindEvents();
  renderMarkdownPreview();
  checkReady();
})();

/** 构建父子标签映射 */
function buildTagParents() {
  tagParents = {};
  for (var mainCat in TAG_CONFIG) {
    var sub = TAG_CONFIG[mainCat];
    if (!Array.isArray(sub)) {
      for (var subCat in sub) {
        var children = sub[subCat];
        for (var i = 0; i < children.length; i++) {
          tagParents[children[i]] = subCat;
        }
      }
    }
  }
}

/** 渲染标签复选框 */
function renderTags() {
  var container = document.getElementById('tagsContainer');
  var html = '';

  for (var mainCat in TAG_CONFIG) {
    html += '<fieldset class="tag-group"><legend>' +
      escapeHtml(mainCat) + '</legend>';

    var subConfig = TAG_CONFIG[mainCat];

    if (Array.isArray(subConfig)) {
      for (var i = 0; i < subConfig.length; i++) {
        html += '<label class="tag-checkbox">' +
          '<input type="checkbox" name="tags" value="' +
          escapeHtml(subConfig[i]) + '">' + escapeHtml(subConfig[i]) +
          '</label>';
      }
    } else {
      for (var subCat in subConfig) {
        var subTags = subConfig[subCat];
        html += '<div class="sub-cat">';
        html += '<label class="tag-checkbox tag-parent">' +
          '<input type="checkbox" name="tags" value="' +
          escapeHtml(subCat) + '">' + escapeHtml(subCat) + '</label>';

        if (subTags.length > 0) {
          html += '<div class="sub-tags">';
          for (var j = 0; j < subTags.length; j++) {
            html += '<label class="tag-checkbox tag-child">' +
              '<input type="checkbox" name="tags" value="' +
              escapeHtml(subTags[j]) + '">' + escapeHtml(subTags[j]) +
              '</label>';
          }
          html += '</div>';
        }
        html += '</div>';
      }
    }

    html += '</fieldset>';
  }

  container.innerHTML = html;
}

/** HTML 转义 */
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 绑定事件 */
function bindEvents() {
  // 文件选择
  document.getElementById('previewInput').addEventListener('change', function (e) {
    var f = e.target.files[0];
    var lbl = document.getElementById('previewLabel');
    if (f) {
      lbl.textContent = f.name;
      lbl.className = 'label selected';
    } else {
      lbl.textContent = '选择预览图';
      lbl.className = 'label placeholder';
    }
    checkReady();
  });

  document.getElementById('litematicInput').addEventListener('change', function (e) {
    var f = e.target.files[0];
    var lbl = document.getElementById('litematicLabel');
    if (f) {
      lbl.textContent = f.name;
      lbl.className = 'label selected';
    } else {
      lbl.textContent = '选择存档文件';
      lbl.className = 'label placeholder';
    }
    checkReady();
  });

  // 名称输入
  document.getElementById('nameInput').addEventListener('input', checkReady);

  // 描述输入 Markdown 预览
  document.getElementById('descInput').addEventListener('input', renderMarkdownPreview);

  // 标签勾选逻辑（事件委托）
  document.getElementById('tagsContainer').addEventListener(
    'change', handleTagChange);

  // 表单提交
  document.getElementById('uploadForm').addEventListener(
    'submit', handleSubmit);
}

/** 标签勾选交互 */
function handleTagChange(e) {
  if (e.target.name !== 'tags') return;
  var tag = e.target.value;
  var cb = e.target;

  if (cb.checked) {
    // 勾选子级 -> 自动勾选父级
    var parent = tagParents[tag];
    if (parent) {
      var parentCb = document.querySelector(
        'input[name="tags"][value="' + escapeHtml(parent) + '"]');
      if (parentCb && !parentCb.checked) parentCb.checked = true;
    }
  } else {
    // 取消父级 -> 取消所有子级
    var subArr = TAG_CONFIG[tag];
    if (subArr && !Array.isArray(subArr)) {
      var subValues = Object.values(subArr);
      for (var i = 0; i < subValues.length; i++) {
        var children = subValues[i];
        for (var j = 0; j < children.length; j++) {
          var childCb = document.querySelector(
            'input[name="tags"][value="' + escapeHtml(children[j]) + '"]');
          if (childCb) childCb.checked = false;
        }
      }
    }
  }
}

/** 检查是否满足提交条件 */
function checkReady() {
  var name = document.getElementById('nameInput').value;
  var pf = document.getElementById('previewInput').files[0];
  var lf = document.getElementById('litematicInput').files[0];
  document.getElementById('submitBtn').disabled = !(name && pf && lf);
}

/** 简易 Markdown 渲染 */
function renderMarkdownPreview() {
  var raw = document.getElementById('descInput').value;
  var el = document.getElementById('descPreview');
  var html = raw
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<strong>$1</strong>')
    .replace(/^## (.+)$/gm, '<strong style="font-size:1.1em">$1</strong>')
    .replace(/^# (.+)$/gm, '<strong style="font-size:1.2em">$1</strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '&bull; $1')
    .replace(/^> (.+)$/gm,
      '<span style="color:#40B5AD;border-left:2px solid #40B5AD;' +
      'padding-left:8px">$1</span>')
    .replace(/\n/g, '<br>');
  el.innerHTML = html;
}

/** 处理表单提交 */
async function handleSubmit(e) {
  e.preventDefault();

  var btn = document.getElementById('submitBtn');
  btn.disabled = true;
  document.getElementById('loading').style.display = 'block';
  document.getElementById('result').style.display = 'none';
  document.getElementById('result').className = '';

  var fd = new FormData(e.target);

  try {
    var url = API_BASE + '/api/upload/submit';
    // 确保 token 以 query 参数传递
    if (url.indexOf('?') === -1) {
      url += '?token=' + encodeURIComponent(TOKEN);
    } else {
      url += '&token=' + encodeURIComponent(TOKEN);
    }

    var resp = await fetch(url, {
      method: 'POST',
      body: fd
    });
    var data = await resp.json();
    document.getElementById('loading').style.display = 'none';

    var resultEl = document.getElementById('result');
    if (resp.ok && data.success) {
      resultEl.className = 'success';
      resultEl.innerHTML =
        '<strong style="color:#40B5AD">投递成功！</strong><br><br>' +
        '作品已提交审核。<br>' +
        (data.issueUrl
          ? '<a href="' + data.issueUrl +
            '" target="_blank" rel="noopener">查看审核 Issue</a>'
          : '') +
        '<br><br>' +
        '<button onclick="location.reload()" ' +
        'style="color:#40B5AD;background:none;border:none;cursor:pointer;' +
        'text-decoration:underline;font-size:13px">投递下一个项目</button>';
    } else {
      resultEl.className = 'error';
      resultEl.textContent = '提交失败: ' + (data.error || '未知错误');
    }
    btn.disabled = false;
  } catch (err) {
    document.getElementById('loading').style.display = 'none';
    var resultEl = document.getElementById('result');
    resultEl.className = 'error';
    resultEl.textContent = '网络错误: ' + err.message;
    btn.disabled = false;
  }
}
