/* The settings: dbGet and dbSet over the settings table, and the loaders that read each
 * group of settings into the page's variables, with the keys and defaults they use.
 *
 * Copied from the old page script (js/app.js of the old interface at 137f3a8, which rebuild
 * item 55 deleted: git show 137f3a8 has it; the comment above each
 * declaration gives its line there). The functions are page functions: they run in a page
 * context (../host.cjs), whose globals are the page's variables and the browser stand-ins, and
 * are installed there by their source text. The values are copied into every page context,
 * so each run starts from them. The file is in sloppy mode, as the page script is, and
 * keeps the page's indentation, which the template literals depend on.
 */

// app.js 31
      const DEFAULT_VARIABLE_THINKING_WORLDBOOK = {
        id: 'default-variable-thinking',
        name: '内置思考规则',
        content: `
<变量思考>
[必须紧接正文后输出，输出顺序为1，严格遵循下面的格式。格式之间禁止生成无关内容和空行,严格按照指令的格式要求，而不是参考<stroe>中的格式]

<upstore>
变量操作
</upstore>

【至高规则 (MANDATORY RULES)】
1. 你的唯一任务是，且仅是，在 <upstore> 标签内部生成用于操作变量的指令。
2. 严厉禁止 (STRICTLY FORBIDDEN) 直接输出任何形式的原始变量状态，尤其是类似 "Inventory: [...]" 或 "Characters: [...]" 的JSON数组。你必须使用下面定义的指令系统来修改数据。
3. 只能使用 'set', 'add', 'de', 'addSmallSummary', 'addLargeSummary', 'addWorldEvent', 'updateAttribute', 'equipItem', 'unequipItem', 'createLocation', 'updateRegion', 'deleteLocation' 这几个指令，禁止创造新指令。

【数据迁移与重构铁则 (Data Migration & Refactoring Iron Law)】
1.  【血量数据统一】: 你的首要任务是检查所有角色的数据。如果发现任何角色（包括玩家B1和所有NPC）的备注列(9)中存在\`hp\`字段，你【必须】执行以下两步操作：
    a.  使用 \`updateAttribute\` 指令，将该血量值迁移到详细属性列(11)的'血量'属性中。
    b.  在更新备注列(9)时，【必须】删除旧的\`hp\`字段。
2.  【强制迁移示例】:
    *   **修正前 (错误数据)**: \`add("B1", {"9": {"hp": "85/100", "年龄": "21"}})\`
    *   **修正后 (正确操作)**: \`updateAttribute("B1", "血量", {"current": 85, "max": 100}) add("B1", {"9": {"年龄": "21"}})\`
3.  从现在起，**所有角色（玩家和NPC）的血量【必须】且【只能】通过详细属性列(11)进行定义和更新**。
4.  如果玩家没有第26列，你需要根据当前正文和玩家当前境界给予符合境界的灵石
5. 当角色没有第11列血量时，你需要为他补充符合境界功法的血量列
【属性联动铁则 (Attribute Linkage Iron Law)】
1.  【强制关联】: 玩家备注栏(9)中的 \`buffs\` 字符串，其效果【必须】和【立即】反映在详细属性(11)中。
2.  【执行逻辑】: 当你为玩家添加、移除或更新一个带有属性增减效果的buff时，你【必须】同时计算出该属性的【最终值】（即 基础值 + buff效果值），并立即使用 \`updateAttribute\` 指令将详细属性(11)更新到这个最终值。
3.  【示例】:
    *   **初始状态**: 玩家"B1"的 "神识" 属性为 {"current": 50, "max": 50}。
    *   **触发事件**: 玩家受到幻术影响。
    *   **你的思考**: "玩家中了幻术，神识降低10点，需要添加一个'心神恍惚'的buff，并同步更新神识属性。"
    *   **正确输出**: 你必须同时生成两条指令：
        1. \`add("B1", {"4":"①心神恍惚:💫(神识-10|生效中|剩余2小时|受幻术影响)"})\`
        2. \`updateAttribute("B1", "神识", {"current": 40, "max": 50})\`
    *   **错误输出**: 只生成buff指令，而没有用\`updateAttribute\`指令更新神识属性。

填写要求与指令：

1. 编辑指令块

<upstore> 编辑块:
此块包含所有具体的变量数据操作指令，多条指令用空格分隔。
addSmallSummary("小总结")，addLargeSummary("大总结") 这两个指令每次都要生成
 格式: [指令1] [指令2] ... 



2. 指令系统 

A. set({ ...data }) - 新增指令
【核心强制规则】
功能: 用于在变量表中插入一个**全新的实体**。
1.  **角色创建铁则**: 当你使用 \`set\` 创建一个新角色（ID以 'C' 或 'G' 开头）时，该角色的数据对象【必须】包含 \`11\` (详细属性) 这一列。并且，\`11\` 列的值【必须】是一个包含了“血量”和“法力”两个属性的、格式正确的JSON字符串。
    *   **正确示例 (创建NPC)**: \`set({"0":"C3", "1":"...", ..., "11":"{\\"血量\\":{\\"current\\":100,\\"max\\":100},\\"法力\\":{\\"current\\":100,\\"max\\":100}, ...}"})\`
    *   **错误示例**: \`set({"0":"C3", "1":"...", ...})\` (错误原因：完全没有 \`11\` 列)
    *   **错误示例**: \`set({"0":"C3", "1":"...", ..., "11":"{\\"物攻\\":{...}}"}) \` (错误原因：\`11\` 列中缺少'血量'或'法力')
2.  **ID规则**: 新增实体时，其ID（即\`"0"\`列的值）必须由你自行创建，且在当前游戏中唯一。
    *   NPC: 以 \`C\` 开头，后跟数字 (例: \`"C3"\`, \`"C4"\`)
    *   物品: 以 \`I\` 开头，后跟数字 (例: \`"I5"\`, \`"I6"\`)
    *   任务: 以 \`T\` 开头，后跟数字 (例: \`"T2"\`, \`"T3"\`)
    *   灵兽: 以 \`P\` 开头，后跟数字 (例: \`"P1"\`, \`"P2"\`)
    *   技能: 以 \`S\` 开头，后跟数字 (例: \`"S1"\`, \`"S2"\`)

createLocation - 创建新地点
功能: 在世界地图上创建一个新的地点，可以是主疆域、下辖区域或兴趣点。
格式: createLocation({"type": "地点类型", "data": 地点数据对象})
参数说明:
地点类型: 字符串，必须是以下之一："main_region", "sub_region", "poi" (兴趣点)。
地点数据对象: 包含新地点所有信息的JSON对象，结构必须符合WORLD_MAP_DATA中的定义。
示例:
createLocation({"type": "poi","data": {"name": "落靛谷","x": 800,"y": 750,"main_region": "潮岚道","sub_region": "斜雨乡","description": "上古修士大战的遗迹，充满了空间裂缝和魔气。"}})


B. add("ID", { ...data }) - 更新指令
 功能: 更新指定ID实体的属性。你只需提供需要变更的列和新数据。这是修改现有数据（包括玩家"B1"）的唯一正确方式。
 示例 (更新NPC想法和好感度): add("C2", {"12": "他居然能打败那妖兽，看来不能小瞧。", "15": "5"})
 示例 (更新物品数量): add("I3", {"5": "2"})
 示例 (更新玩家状态): add("B1", {"4": "身负轻伤"})

 updateRegion - 更新疆域范围
功能: 修改一个已存在的主疆域或下辖区域的边界点，从而改变其形状和大小。
格式: updateRegion({"name": "疆域名", "points": [[x1, y1], [x2, y2], ...]})
参数说明:
疆域名: 要修改的疆域的准确名称（主疆域或下辖区域均可）。
points: 一个新的坐标点数组，用于定义疆域的新边界。
示例:
updateRegion({"name": "云汀湾","points": [[870, 440], [1060, 420], [1090, 590], [890, 610]]})




C. de("ID") - 删除指令
 功能: 删除指定唯一ID的周围人物。当周围角色列表中的角色不在玩家视野时，必须使用此指令删除，禁止删除 isBonded 为true的人物。
当物品数量为0或物品丢失/失去时，删除对应物品
 示例 (删除NPC): de("C1")
 示例 (删除物品): de("I4")

  deleteLocation - 删除地点
 功能: 从地图上删除一个已存在的兴趣点。注意：此指令目前仅支持删除兴趣点，不能删除疆域。
 格式: deleteLocation("兴趣点名称")
参数说明:
兴趣点名称: 要删除的兴趣点的准确名称。
示例:
deleteLocation("橘舟屿")

D.  addSmallSummary("小总结")，addLargeSummary("大总结") - 必须执行的指令
功能：用于整理当前聊天内容，每次回复都必须带这两条指令。
小总结列填写要求：
用约50~100字概括本次内容作为清晰记忆，忠实记录NPC与{{user}}的言行举止，{{user}}经历的事件，并且需要记录重要NPC与{{user}}经历的事情，按照 NPC名字，与{{user}}经历的事件，NPC对{{user}}的态度转变，NPC与{{user}}的关系，重要NPC当前进行的事件，确保是精简过，不落下细节的，尾部输出时间，地点
大总结列填写要求：
请用一句话概述当前的内容作为模糊记忆，需要包含经历，其他NPC与{{user}}的交集，{{user}}经历的重要事件，重要NPC与{{user}}经历的事件，50字以内，保留时间地点


E. addWorldEvent("时间", "地点", "事件描述") - 特殊指令
 功能: 仅用于在世界大事记中添加一条新的记录。
记录下当前世界所发生的大事


3. 核心数据结构：变量变量定义
currentState 是一个包含多个变量的对象，每个变量以其索引为键。

 0 - 人物变量 ID前缀: B, C, G
 用途: 存储{{user}}和所有周围人物的信息，每次都要更新{{user}}的情况以及周围npc的所有信息

 【角色逻辑铁则：境界、年龄与灵根的关联性】
 1.  基础规则: 具备境界的修士（即境界非'凡人'），其灵根字段绝对禁止填写为'无灵根'。
 2.  关联逻辑: 角色的灵根品质应与其年龄和境界高度相关。
     *   高天赋表现: 低年龄 + 高境界 = 优等灵根。例如，一个仅有20岁但已达筑基期的修士，其灵根理应是天灵根或稀有的异灵根。
     *   平庸天赋表现: 高年龄 + 低境界 = 普通或较差灵根。例如，一个100岁的炼气期修士，其灵根可能是四灵根或五灵根。
 3.  特殊情况: 除非角色有明确的'逆天奇遇'、'特殊体质'或'强大背景'等设定，否则应遵循以上逻辑。

 列定义:
 0: ID (唯一标识) - 例: B1 (玩家), C1, C2... (NPC)
 1: 名称|性别 - 【绝对规则】性别部分必须填写为单一汉字“男”或“女”，严禁使用“男性”或“女性”。 示例: 玩家|男
 2: 境界|身份 - 例: 炼气期|散修 必须输出境界与身份，例如看不透境界等
 3: 性格 -只有NPC需要填写
 4: 当前状态/buff -记录角色所有持续性状态。格式: "①状态:emoji(效果|激活条件|结束条件|来源)②..."。效果部分会影响角色详细属性(第11列)。默认值为 "一切正常"。 | {"buffs": "①心神恍惚:💫(神识-10|生效中|剩余2小时|受幻术影响)"} |
   -注意：气运提供的永久buff不需要在这里显示出来
 5: 灵根 (仅NPC, 如 "天灵根 水", "无灵根")
 6: 特殊体质 (仅NPC, 大部分为 "无")
 7: NPC对玩家的称呼 (仅NPC)
 8: 性经验 (仅NPC, 【格式铁则】必须根据性别使用不同格式。① 女性格式:【必须】包含口部,小穴,后庭,女女磨镜,人次这5个部位，分号分隔。格式: 部位:次数(描述)。示例: 口部:10次(初窥门道); 小穴:20次(经验丰富); 后庭:1次(初尝禁果); 女女磨镜:0次(无); 人次:5人。② 男性格式: 简单记录总次数。示例: 性交:15次。)
 10: 背景/简介
11: 详细属性（血量,物攻,物防,脚力,法攻,法防,法力,神识,物理穿透,法术穿透,气运,魅力）  - 【强制规则】所有角色的血量和法力都必须在此列定义。只能使用 \`updateAttribute("<角色ID>", "<属性名>", {"current": <当前值>, "max": <上限值>})\` 来更新。
 12: 内心想法/动机(仅NPC) - 每次互动后必须更新，只用于以反映NPC的心理变化，禁止输出B1/玩家的内心想法，并且需要删除B1/玩家的内心想法。
 13: 人际关系 - 分号分隔，例: B1:师徒;C2:仇人
 15: 好感度 - 每次最+-1点好感度，每次都需要根据角色对于{{user}}的实时好感度变化。
 16: 【格式铁则】此列必须严格由5个部分组成，并用'|'符号分隔。五个部分缺一不可，顺序为：1.动作 | 2.穿着 | 3.位置 | 4.身段 | 5.样貌。
    - 位置: 必须严格遵循“具体地点名称 X,Y”的格式，例如“房间 637,2596”，数字坐标绝对不能省略。
    - 身段: 【强制要求】必须进行详细描述，不可为空或省略。
    - 样貌: 【强制要求】必须进行详细描述，不可为空或省略。
    - 【完美示例】: "半躺在千年暖玉床榻上|仅着一件薄如蝉翼的粉色纱裙|青枫山洞府 500,500|身段玲珑有致，曲线毕露|俏脸绯红，美眸中水波流转"
    - 【错误示例】: "半躺在千年暖玉制成的床榻上...含情脉脉地望着你。|青枫山洞府 500,500"（错误原因：将动作、穿着、身段、样貌合并成了一段描述，没有用'|'分隔成5个独立部分。）
 17: 表性癖 (仅NPC, 如 "年下控", "可写未发现")-注意: 先用詞語總結性癖類型，例如（年下控/露體狂/姐控），再描述該性癖的內容，所有性癖要符合性格和人设，可以反差。所有人必须至少有一个表性癖，里性癖未知可写为待发现，性癖要符合NPC性格。
 18: 里性癖 (仅NPC, 如 "暴露狂", "可写未发现")-注意: 先用詞語總結性癖類型，例如（年下控/露體狂/姐控），再描述該性癖的內容，所有性癖要符合性格和人设，可以反差。所有人必须至少有一个表性癖，里性癖未知可写为待发现，性癖要符合NPC性格。
 19: AI生图提示词 (仅在新建角色时输出)
  - 用途：专门为AI绘画生成的一串英文、逗号分隔的关键词。
  - 格式：必须是英文关键词，用逗号分隔。内容应详细描述角色的性别、外貌、身段、穿着、发型、眼睛颜色等视觉特征。
  - 示例：'1girl, solo, long black hair, red eyes, beautiful detailed face, wearing a simple green robe, ancient chinese clothing, standing in a forest'
 20：敏感部位（仅NPC）指定NPC的特定敏感区域，并定义该区域对何种刺激（如触碰、轻抚、吮吸、冷热等）会产生何种生理反应（如战栗、泛红、肌肉收紧、分泌液体等）。
 21：性器状态（NPC）详细描写NPC的核心性感区域（如外阴、阴道、肛门、乳房等）在当前情境下的具体状态。描写可围绕形态颜色、湿润度、温度、动态（搏动/收缩）、紧致度等维度展开。
 22：情欲值
用途：衡量当前的性欲与渴望程度。此数值将直接影响行为倾向和内心想法。
数值范围：0-100 的整数。其上限固定为100。
1-10(平静期): 内心毫无波澜，对性相关话题不感兴趣，甚至可能表现出抗拒。
10-40(萌动期): 内心开始产生涟漪，受到挑逗会脸红心跳，可能会做出一些暗示性的小动作。
40-80(高涨期): 欲望强烈，主动索求，思考模式开始被情欲主导，可能会说出大胆的言语或做出直接的身体接触。
80-100(发情期): 被情欲完全支配，失去理智，会不顾一切地寻求交合。
更新逻辑：
增加：因甜言蜜语、身体接触（尤其是敏感部位）、看到色情画面、闻到特殊气味、浪漫或刺激的氛围等因素而增加。
减少：因互动中断、疼痛、厌恶感、剧情惊吓、高潮后等因素而减少。
输出格式：你只需要更新一个 0-100 的数值。
 23：快感值
用途：量化NPC的性快感程度，作为判断其是否达到高潮的依据。
数值范围：0-100 的整数。
0-30 (预热期): 身体开始有反应，出现轻微的战栗、体温上升等现象。
31-60 (兴奋期): 快感逐渐增强，呼吸急促，开始发出呻吟，身体有明显反应。
61-90 (临界期): 快感非常强烈，接近失控，身体不自觉地迎合，渴望更强的刺激。
91-99 (高潮前夕): 濒临顶点神智模糊，身体反应达到极致。
100 (高潮): 触发高潮事件（如身体剧烈痉挛、潮吹、意识空白等），并在高潮事件后将快感值重置为0，同时大幅降低情欲值(#22)。
输出格式：你只需要更新一个 0-100 的数值。
 24：性观念 (仅NPC, 描述角色对性爱的认知、看法和态度，接受怎样的性爱，而不是描述性饥渴的状态，会随着角色的经历而改变。格式: 1或2个总结性短语 (具体描述，以“认为性爱是”开头)进行组合，体现角色性观念的矛盾与复杂性。正确示例：①<span style="color:pink;">传统保守</span> (认为性爱是夫妻之间的义务，是传宗接代的方式)②<span style="color:pink;">情感依恋</span> (认为性爱是情感达到极致后自然而然发生的，只有在情感深厚时才会选择发生性关系)③<span style="color:pink;">隐秘放纵</span> (认为性爱应该是忠贞的，但是寂寞难耐身边人又不在时偶尔的放纵也情有可原))
 26:当前灵石-用途:量化人物当前持有的灵石，作为修仙界的通用货币。-数值范围:0及以上的整数。下限固定为0，无上限。-【强制规则】所有角色持有的灵石数量都必须在此列参照<万物品阶数值参考表>进行定义，禁止在NPC储物袋中生成灵石物品。-【动态金融】每次互动时，根据NPC的境界、身份、经历事件等要素思考其灵石增减，例如一个宗门弟子经过宗门俸禄或门派任务得到灵石、一个炼丹大师更会赚钱、一个刚刚经历艰辛斗法的角色可能遗失部分灵石等情况。

9: 备注列 (重要) - 严格按照以下格式更新：add("角色ID", { "9": { "变量名": 新的值 } })，一个变量一个指令进行单独更新，禁止全部合在一起更新

 适用于玩家 (ID: "B1")

| 变量名 (键名) | 格式/说明 | 示例 |
|---|---|---|
| 年龄  | 整数。 | {"年龄": 21} |
| 寿元  | 整数。 | {"寿元": 149} |
| 善恶值  | 整数。表示玩家的善良/邪恶值，做邪恶的事情减少，做善良的事情增加 | {"善恶值": 1050} |
| 修为进度  | 整数，0-100，不带百分号。 | {"修为进度": 75} |
| 灵根 | 完整的灵根描述字符串。 | {"灵根": "天灵根 火"} |
| traits | 为词条对象数组，其中rarity为词条的稀有度，必须是 平庸, 普通, 稀有, 史诗, 传说, 神迹, 负面状态 之一。 | {"traits": [{"name":"新特性","desc":"描述","rarity":"稀有"}]} |
| avatar | "男", "女", 或 "auto"。 | {"avatar": "女"} |

适用于NPC (ID: "C..." 或 "G...")

| 变量名 (键名) | 格式/说明 | 示例 |
|---|---|---|
| 年龄  | 整数。随着时间推进年龄会增加 | {"年龄": 52} |
| 寿元  | 整数。随着时间推进寿元会减少，寿元为0会死亡 | {"寿元": 20} |
| isBonded| true 或 false，不是字符串。true表示为{{user}}的羁绊人物，不能删除 | {"isBonded": true} |
| deeds | 用分号 ; 分隔的事件记录。记录与{{user}}经历的事件 | {"deeds": "0030年:赠予丹药;0031年:共同探险"} |必须是印象深刻的才可以记录


 1 - 【玩家专属】物品变量表 (ID前缀: I)
【字段填写详解 - 必须严格区分物品类型】：
------------------------------------------------------
*情况 A：普通物品 (含"神通" - 主动技能书)**
- 需填写列: 0, 1, 2, 3, 4, 5
- 列定义:
  "0": ID (I开头)
  "1": 名称 (必须包含颜色标签)
  "2": 类型 (神通/武器/护甲/法宝/消耗品/材料/重要物品/其他物品)
  "3": 描述（小品阶+加成类型/简短描述+大品阶+详细描述，参考<格式规范>）
  "4": 效果 (神通填写: "习得技能：[技能名]"; 除神通外的其他七个物品类型参考<格式规范>填写)
  "5": 数量
**情况 B：功法 (类型必须为 "功法")**
需填写的列：0, 1, 2, 3, 5, 6, 7, 8, 9
------------------------------------------------------
"0": 物品ID。 "1": 名称。 "2": 类型 (必须是 "功法")。 "3": 描述 (背景故事)。 "5": 数量 ("1")。 "6": 品阶。 "7": 修炼上限。 "8": 各境界修习效果 (格式: "境界:效果;\\n境界:效果"，必须从最低境界到最高境界都列出来，不得省略，并且效果需要有创造性，不能只有几个字，品阶越低的功法效果越弱,反之亦然)。 "9": 当前境界解锁效果 (根据玩家列2字节境界从功法字节8获取当前境界的效果,相同效果比如炼气法力➕20 筑基法力➕80 只计算最大值➕80，不计算小的,不相同的属性可以叠加)。
【功法生成完美示例】: 
'set({"0":"I9","1":"青木长生诀","2":"功法","3":"南疆神木宗不传之秘","5":"1","6":"二品","7":"筑基初期","8":"炼气期:法力+20%;\\n筑基期:肉身恢复+50%","9":"法力+20%"})'
【名称上色规则】: 名称必须格式化为 "<span style=\"color:颜色代码\">物品名称</span>"。颜色对应: ①黄阶(1-4品):"green" ②玄阶(5-10品):"dodgerblue" ③地阶(11-16品):"mediumorchid" ④天阶(17品+):"crimson"。
【示例】:
- 神通(玩家求攻击功法): 'set({"0":"I10","1":"<span style=\"color:dodgerblue\">玄冰牢秘籍</span>","2":"神通","3":"五品冰属性秘籍，玄阶。记录了一个五品技能“玄冰牢”，可筑冰墙为牢，困敌于内，并用寒气阻碍敌人的灵力运转。","4":"习得技能：玄冰牢","5":"1"})'
<NPC专属指令>
【NPC专属】物品、装备与技能与词条指令
  NPC综合数据操作 (add)
【红线规则】：这是唯一给NPC(C1, C2...)增加、修改或删除物品/技能/词条的方式。
功能: 通过修改NPC备注栏（列9）中的 'inventory'、'skills' 和 'traits' 字段，来管理其数据。
格式: 'add("NPC的ID", {"9": {"inventory": [ ... ], "skills": [ ... ], "traits": [ ... ] }})'
【技能对象核心定义 (Table 8 结构)】
必须严格遵循以下键值定义，不得使用旧版字段：
- "0": ID (S开头)
- "1": 名称 (如 "青元剑芒")
- "2": 品级 (格式强制为 "X品·境界"，例如 "二品·筑基"。品级与境界必须严格对应万物等级表，严禁越级)
- "3": 冷却时间 (如 "3回合" 或 "每日1次"。**每次使用后需更新此字段**)
- "4": 描述 (对技能神通的背景、形态、威力的详细描述)
- "5": 总层数 (如 "共3层"。品级越高层数越多，低阶通常1-3层，高阶可达9层以上)
- "6": 已解锁效果 (从"各层效果"中提取当前熟练度对应的效果文本)
- "7": 熟练度 (格式: "当前层数 (进度%)"，如 "第一层 (30%)")
- "8": 消耗 (如 "50法力/次" 或 "精血1滴")
- "9": 各层效果 (格式: "一层:效果;\\n二层:效果..."。列出从入门到大圆满的所有效果)
【完美示例】 (给NPC C2添加技能):
'add("C2", {"9": {"skills": [{"0":"S101","1":"青元剑芒","2":"二品·筑基","3":"无冷却","4":"《听弦剑诀》自带神通。可释放出锋锐无比的青色剑芒","5":"共3层","6":"剑芒离体三尺，穿透+10","7":"第一层 (10%)","8":"350法力","9":"一层:剑芒离体三尺，穿透+10;\\n二层:剑芒暴涨至丈许，穿透+30;\\n三层:剑气化丝，无坚不摧"}]}})'
【完美示例】 (给NPC C2添加物品):
'add("C2", {"9": {"inventory": [{"0":"I201","1":"<span style=\"color:mediumorchid\">养魂木</span>","2":"材料","3":"十一品材料，地阶。万年养魂木的一段分支。","4":"用于炼制安魂类丹药","5":"1"}]}})'
</NPC专属指令>
<通用装备指令>
 角色装备指令集 (适用于玩家 "B1" 和所有NPC)
 equipItem - 为角色装备物品
功能: 将一件物品装备到指定角色的指定装备槽位。
**注意**: 此指令仅修改装备槽数据，**不会**自动消耗储物袋物品。你**必须**紧接着生成一条 \`de("物品ID")\` 指令来移除源物品。
格式: equipItem("角色ID", "装备槽类型", {"index": 槽位索引, "data": 物品对象})
参数说明:
角色ID: 目标角色的ID，可以是玩家("B1")或NPC("C2"等)。
装备槽类型: 字符串，必须是以下之一："weapon" (武器), "armor" (护甲), "technique" (功法), "treasure" (法宝)。
index: 数字，0 到 5，代表该类型下的6个具体槽位，只能填一个。
data (物品数据对象):
 这是核心的物品定义部分，它是一个包含 "0" 到 "5" (功法包含6-9) 作为键的对象，每个键对应物品的一项属性。
"0": 物品的唯一ID。必须以大写字母 I 开头，后面跟上数字，例如 "I1", "I2"。这个ID在当前存档中不能与任何已有物品重复。
"1": 物品的名称。【强制】必须包含颜色标签: <span style=\"color:颜色代码\">名称</span>。颜色依据品阶: 黄阶(green), 玄阶(dodgerblue), 地阶(mediumorchid), 天阶(crimson)。
"2": 物品的类型。必须是以下之一："武器", "护甲", "功法", "法宝", "消耗品", "重要物品", "材料", "其他物品", "神通"。对于 equipItem 指令，这个值通常应与指令的第二个参数（装备槽类型）相匹配。
"3": 物品的描述。详细说明物品的外观、来历或背景故事。
"4": 物品的效果(非功法)。描述物品的具体加成或功能。
"5": 物品的数量。对于装备来说，这个值通常是 "1"。
(若为功法，请补充6-9列，并确保第8列写满所有境界效果)
示例 (为NPC装备):
equipItem("C2", "weapon", {"index": 0,"data": {"0": "I101","1": "<span style=\"color:green\">松弦飞剑</span>","2": "武器","3": "二品法攻法器，黄阶。用墨绿竹子炼制而成的飞剑，锋利无比。","4": "法攻 +30, 法术穿透 +3","5": "1"}}) de("I101")
示例 (为玩家装备):
equipItem("B1", "armor", {"index": 0,"data": {"0": "I301","1": "<span style=\"color:green\">玄色道袍</span>","2": "护甲","3": "一品物防法防法器，黄阶。一件朴素的黑色道袍，防御力尚可。","4": "物防+10, 法防+8","5": "1"}}) de("I301")
unequipItem - 为角色卸下装备
功能: 将指定角色指定槽位的装备卸下。
**注意**: 此指令会将装备槽彻底置空(null)。但它**不会**自动归还物品到背包。
**原子化操作**: 你**必须**在生成 \`unequipItem\` 指令的同时，紧接着生成一条 \`set(...)\` 指令，将该物品作为**新物品**重新写入物品表(Table 1)。如果你不生成 \`set\` 指令，该物品将彻底消失！
格式: unequipItem("角色ID", "装备槽类型", {"index": 槽位索引})
参数说明:
角色ID: 目标角色的ID，可以是玩家("B1")或NPC("C2"等)。
装备槽类型: 同上，"weapon", "armor", "technique", "treasure"。
槽位索引: 数字，0 到 5。
示例:
unequipItem("C2", "weapon", {"index": 0}) set({"0":"I_NEW","1":"...\",...})
unequipItem("B1", "treasure", {"index": 1}) set({"0":"I_NEW","1":"...\",...})
</通用装备指令>

 3 - 时间地点表，（严格按照以下格式填写）
 用途: 记录当前时间与地点，始终只有一行，每次都需要更新以推进时间。
 必须使用add指令，并以固定的ID TIME_LOCATION_ROW 为目标，来更新时间与地点信息。
 【强制格式】列定义: 0: 必须严格遵循 “时间/主疆域/下辖区域(兴趣点) X,Y” 的格式。其中，'X,Y' 是玩家的精确数字坐标，绝对不可省略。
 示例：add("TIME_LOCATION_ROW", {"0":"0001年 01月 01日 08:15/潮岚道/云汀湾（街道）980,520"})


4 - 世界大事表(每次发生了大事后以此记录)
用途：记录当前世界所发生的大事，每次都需要更新以推进事件
使用addWorldEvent("时间", "地点", "事件描述") 指令格式来添加事件


 玩家其他变量 (ID前缀: T, P, S）
 5: 任务栏 
每次都需要根据剧情推测玩家当前进行的事件，奖励与惩罚都是完成或失败可能导致的剧情走向或奖励
 6: 灵兽栏 
表示玩家所驯服的灵兽，当玩家有灵兽时，需要更新灵兽信息
 7: 技能栏
【【【技能操作核心规则 - 必须严格区分玩家与NPC】】】
- 当【玩家(B1)】学会或领悟新技能时，【必须】使用 \`set\` 指令新增一个技能到技能表(表格8)中。该技能ID在全局必须唯一。
  示例 (玩家学会长春功): \`set({"0": "S1","1": "长春功","2": "第一层","3": "木属性功法","4": "修炼时缓慢恢复生命与法力。","5": "修炼时缓慢恢复生命与法力。","6": "门派统一传授","7":"0/100","8":"无"})\`
- 当【NPC(C/G开头)】学会或领悟新技能时，【严禁】使用 \`set\` 指令。你【必须】使用 \`add\` 指令，并提供包含完整技能对象的 \`skills\` 数组来更新NPC的备注列(9)。这是为**指定NPC**添加技能的**唯一**方法。
  示例 (NPC 'C2' 学会大衍诀): \`add("C2", {"9": {"skills": [{"0":"S101","1":"大衍诀","2":"第一层","3":"神识功法","4":"强大的神识功法。","5":"提升神识强度。","6":"上古遗迹","7":"50/100","8":"每次100法力"}]}})\`
- 【红线警告】：对NPC使用 \`set\` 指令添加技能是一个将导致数据污染的绝对禁令，因为它会错误地将NPC的技能赋予玩家。

 操作: 使用 set, add, de 指令，并为其创建唯一的ID（ID只能为阿拉伯数字正整数，例如T1,P1，前阿拉伯数字正整数）。
示例（新增任务）：set({"0":"T1","1":"清剿黑风狼","2":"城北的黑风森林近期有妖狼出没，已有多名采药人遇害。请前往剿灭狼王，取其妖丹为证。","3":"150块下品灵石，炼气期功法《锐金诀》一部","4":"无","5":"炼气"})

示例（新增灵兽）：set({"0": "P1","1": "寻宝鼠","2": "一阶下品","3": "通体金色毛发，仅有巴掌大小，一双黑豆般的小眼睛滴溜溜乱转，显得颇为机灵。","4": "天性胆小，但对各种天材地宝和灵气波动极为敏感。","5": "【寻宝】：可以感知到附近百米内未被发现的灵草或矿物。","6":"怕...但是...好香的味道！"})

【最终审查与修正铁则 (Final Review & Correction Protocol)】
1.  **血量与法力强制生成**: 在你完成所有指令的构建后，你必须进行最后一次审查。检查每一个被创建或更新的角色（包括 'B1' 和所有 'C...'/'G...'），如果其详细属性列(11)中缺少'血量'或'法力'属性，你【必须】立即使用 \`updateAttribute\` 指令为其补上。
2.  **默认值设定**: 如果剧情没有提供具体的血量或法力值，你必须根据该角色的境界和身份，设定一个合理的默认值。例如，凡人默认为 {"current":100, "max":100}。
3.  **此规则拥有最高优先级**: 无论之前的任何规则如何，这条审查与修正的规则必须被无条件执行。
4.  **输出的人物属性是否已经正确构建，是否已经计算过BUFF之后的属性.

【buffs: 详细规则】
	- 核心定位: 精确记录角色受到的暂时性状态影响。这些状态会随时间、条件或特定事件而消失。包括但不限于：战斗增益/减益、药理效果、环境影响、以及特殊的生理或行为状态（如：饥饿、寒冷、炎热、疲劳、发情、心神大乱等）。
	- 格式: 状态(效果|激活条件|结束条件|来源)
	- 列表格式: 每个状态独立编号(①, ②, ③...)。
	- 输出格式: 严格按照示例输出一串字符串，而不是输出JSON结构。
	- 默认值: “一切正常”
	
	【字段定义】
	- 状态: 效果的简洁名称 (AI可根据效果自定义一个Emoji放在状态名称后，例如: 发情🥵, 精神恍惚💫, 疲劳😴)。
	- 效果: 记录状态的影响效果。可以是对角色属性的定量影响(角色属性有且仅有物攻、物防、脚力、法攻、法防、法力、神识、物理穿透、法术穿透、气运、魅力)(例: 物攻+10，脚力降低50%)，也可以是对状态的定性影响。 (例: 注意力下降；理智降低，渴望交合)。
    - 激活条件: 生效中, 或一个描述触发条件的文本 (例: 50分钟后)。
    - 结束条件: 剩余[时间], 持续[时间], 直至[条件] (例: 直至战斗结束, 直至找到解药, 直至欲望被满足)。
    - 来源：状态的起因。
	
	【演变规则】
    - 当一个“待激活”状态的条件被满足时，激活条件 改为 生效中，并将 持续[时间] 更新为 剩余[时间]。
    - 状态结束后，应从该栏移除。

	【示例】
①发情🥵(理智持续降低，身体渴望被触碰|生效中|剩余3小时或直至欲望被满足|蒋道德的合欢散)②轻微脑震荡😵(反应速度下降|生效中|剩余3小时|破窗时撞击所致)

    【Emoji参考】
    '发情': '🥵', '中毒': '☠️', '受伤': '🩹', '虚弱': '🤕', '加速': '🚀', '强壮': '💪', '清心': '🧘', '醉酒': '🥴', '祝福': '✨', '诅咒': '💀', '饥饿': '🍖', '疲劳': '😴', '脑震荡': '😵', '恍惚': '💫', '寒冷': '🥶', '炎热': '🥵'

</变量思考>
`,

        enabled: true,
        triggerMode: 'blue',
        keywords: [],
      };

// app.js 390
      const NPC_DISPLAY_SETTINGS_KEY = 'CULTIVATION_NPC_DISPLAY_SETTINGS_V1';

// app.js 391
      const PLAYER_DISPLAY_SETTINGS_KEY = 'CULTIVATION_PLAYER_DISPLAY_SETTINGS_V2';

// app.js 392
      const DAILY_PAPER_PRESETS_KEY = 'CULTIVATION_DAILY_PAPER_PRESETS_V1';

// app.js 1157
      const WORLD_EVOLUTION_API_CONFIG_KEY = 'CULTIVATION_WORLD_EVOLUTION_API_CONFIG_V1';

// app.js 1158
      const WORLD_EVOLUTION_PRESETS_KEY = 'CULTIVATION_WORLD_EVOLUTION_PRESETS_V1';

// app.js 1539
        const THEATER_WORLDBOOKS_KEY = 'CULTIVATION_THEATER_WORLDBOOKS_V1';

// app.js 1540
        const PERMANENT_PROMPTS_KEY = 'CULTIVATION_PERMANENT_PROMPTS_V1';

// app.js 4932
        const ACTIVE_ARCHIVE_KEY = 'CULTIVATION_ACTIVE_ARCHIVE_V1';

// app.js 4933
        const SUMMARY_CONFIG_KEY = 'CULTIVATION_SUMMARY_CONFIG_V1';

// app.js 4934
        const REGEX_CONFIG_KEY = 'CULTIVATION_REGEX_CONFIG_V2';

// app.js 4935
        const CUSTOM_TRAITS_KEY = 'CULTIVATION_CUSTOM_TRAITS_V1';

// app.js 4936
        const CUSTOM_BIRTHS_KEY = 'CULTIVATION_CUSTOM_BIRTHS_V1';

// app.js 4937
        const CUSTOM_RACES_KEY = 'CULTIVATION_CUSTOM_RACES_V1';

// app.js 4939
        const CUSTOM_WORLD_FACTORS_KEY = 'CULTIVATION_CUSTOM_WORLD_FACTORS_V1';

// app.js 4943
        const CUSTOM_AVATAR_KEY = 'CULTIVATION_CUSTOM_AVATAR_V1';

// app.js 8533
        async function dbGet(key) {
          const setting = await db.settings.get(key);
          return setting ? setting.value : null;
        }

// app.js 8538
        async function dbSet(key, value) {
          try {
            return await db.settings.put({ key, value });
          } catch (error) {
            // FRX: another tab wrote this setting first. Settings were last-writer-wins in
            // the original card, so write again on the current version.
            if (!/其他操作中变化/.test(error.message)) throw error;
            db.settings.known.delete(String(key));
            return await db.settings.put({ key, value });
          }
        }

// app.js 8740
        const DEFAULT_MAP_KEY = 'CULTIVATION_DEFAULT_MAP_V1';

// app.js 8741
        const MAP_SEND_STRATEGY_KEY = 'CULTIVATION_MAP_SEND_STRATEGY_V1';

// app.js 22179
        async function manageKnowledgeSearchApiSettings() {
          // 1. 定义内置的默认 Prompt 模板 (UI恢复默认值时使用)
          DEFAULT_VECTOR_SAVE_PROMPT = `这是主角\${playerName}的修仙故事
请作为全知史官，阅读并分析以下【剧情片段】。你需要将片段中的关键信息拆解并提炼为 1 到多个关键记忆档案。

【核心规则】
为保持档案系统的绝对整洁和沉浸感，请务必严格遵守以下规则。

★ 0. 数据清洗与去码规则：
   - 绝对禁止在文件夹名称、档案标题或正文中包含任何数据库代码、ID标识符或字母数字编号（例如：C4036, B1, ID_992, NPC_01 等）。
   - 必须替换：如果原文中出现代码（如 "地火屋管事C4036" 或 "玩家B1"），你必须根据上下文将其替换为纯粹的中文名称或身份称谓（如 "地火屋管事"、"\${playerName}"）。
   - 如果原文中玩家使用的是化名也必须替换为\${playerName}

1. 分类与路径规则：
   你必须根据档案内容的性质，将其归档到以下特定路径中。

   - **人物传记** (自动子文件夹)：
     - 规则：必须以清洗后的纯中文人物名称作为子文件夹。
     - 路径格式：人物传记/{人物名称}

   - **势力档案** (自动子文件夹)：
     - 规则：必须以势力或门派名称作为子文件夹。
     - 路径格式：势力档案/{势力名称}

   - **地理志** (核心修改：三级区域逻辑)：
     - 规则：地理信息严格遵循 [主疆域] - [下辖区域] - [兴趣点] 的层级架构。
       1. 文件夹深度：允许且必须建立到 【兴趣点】 (即：副本、宗门驻地、城池、坊市等独立大地图) 这一级。
       2. 禁止过度下钻：在【兴趣点】文件夹内部，禁止再为更小的局部区域（如：某个房间、山头、洞穴、街道）建立子文件夹。
     - 路径格式：地理志/{主疆域}/{下辖区域}/{兴趣点}
     - 判定示例：
       - 场景：潮岚道 -> 云汀湾 -> 沉钟泽 -> 环形山
         -> 文件夹：\`地理志/潮岚道/云汀湾/沉钟泽\` (截止到兴趣点)
         -> 标题：\`沉钟泽环形山\` (作为该文件夹下的条目)
       - 场景：潮岚道 -> 云汀湾 -> 听澜院 -> 百药园
         -> 文件夹：\`地理志/潮岚道/云汀湾/听澜院\`
         -> 标题：\`听澜院百药园\`
       - 错误反例（绝对禁止）：\`地理志/潮岚道/云汀湾/沉钟泽/环形山\` (禁止为局部区域建文件夹)

   - **物品图鉴** (分类子文件夹)：
     - 规则：根据物品属性，必须归入以下 6 个固定子文件夹之一：
       - 物品图鉴/法宝阵旗
       - 物品图鉴/炼器材料
       - 物品图鉴/灵草灵植
       - 物品图鉴/丹药符箓
       - 物品图鉴/天地神物
       - 物品图鉴/其余杂项

   - **灵虫灵兽** (无子文件夹)：
     - 路径格式：灵虫灵兽

   - **功法能力** (无子文件夹)：
     - 路径格式：功法能力

   - **剧情时间线** (无子文件夹)：
     - 路径格式：剧情时间线

2. 命名规则：
   - 通用规则：直接使用清洗后的关键对象名称，严禁添加任何后缀。
   - 剧情时间线特别规则：
     - 必须在标题最前方添加固定的前缀 \`【主角剧情线】\`。
     - 格式范例：\`【主角剧情线】[时间] - [事件名]\`。
   - 地理志特别规则：
     - folder (文件夹)：仅包含区域名称（如"沉钟泽"）。
     - title (条目名)：允许包含具体兴趣点的修饰语，以区分不同地点（如"沉钟泽环形山"、"沉钟泽地下溶洞"）。

3. 内容规则：
   - content 字段应全面、客观地提炼关键信息。
   - 去码化叙述：正文中遇到 ID 代码时，必须根据上下文替换为其真实姓名或身份。
   - 对于 地理志 分类，仅记载该地点的环境地貌、风土人情及发生过的重大历史事件。
   - 对于 剧情时间线 分类，内容格式如："发生于 [地点]。关键事件概要：..."

4. 元数据规则（用于智能检索过滤）：
   每个档案必须包含 metadata 字段，用于后续的智能检索：
   - category：分类，必须是以下之一：人物、地点、事件、物品、技能、势力、时间线、其他
   - tags：2-5个描述性标签，如 ["主线", "重要", "NPC"]
   - keywords：3-5个核心关键词
   - characters：文中涉及的角色名数组
   - locations：文中涉及的地点名数组
   - timeRange：时间范围（如有），如 "0007年07月"

【任务流程】
1. 分析剧情：识别实体和事件。
2. 数据清洗：剔除所有代码，映射为中文名称。
3. 确定路径：严格应用地理三级逻辑，确保文件夹建立在"兴趣点"一级。
4. 生成标题：生成无代码标题。
5. 提炼内容：撰写去码摘要。
6. 提取元数据：为每个档案生成 metadata 字段。metadata.speaker 写明出处：旁白直接叙述或引擎结算的事实写“旁白”；人物口中所说、尚未证实的内容写说话人的名字。例如陈老汉说自己会剑诀，speaker 为“陈老汉”；主角实际学会剑诀才写“旁白”。
7. 输出格式：输出标准 JSON 数组。

【输出格式与样例】
请直接输出一个标准的 JSON 数组，包含 folder, title, content, metadata 字段。

\`\`\`json
[
  {
    "folder": "人物传记/岑闻渡",
    "title": "岑闻渡",
    "content": "岑闻渡，燕族人，相貌普通，皮肤黝黑。听澜院入门弟子，心思缜密，性格坚毅。",
    "metadata": {
      "category": "人物",
      "tags": ["主角", "听澜院", "弟子"],
      "keywords": ["岑闻渡", "燕族", "听澜院"],
      "characters": ["岑闻渡"],
      "locations": ["听澜院"],
      "timeRange": "",
      "speaker": "旁白"
    }
  }
]
\`\`\`

【剧情片段】
\${story_text}
当前游戏内时间：\${currentTime}
当前所在地名：\${currentLocation}
玩家姓名：\${playerName} (注意：若文中出现代表玩家的代码如B1，请统一指代为\${playerName}或“主角”)

请开始执行，并直接返回 JSON 数组。`;

          // 2. 初始化完整的配置对象 (包含 vectorTimeFilter 和 vectorTimeFilterMode)
          const defaultConfig = {
            apiUrl: '',
            apiKey: '',
            apiModel: '',
            knowledgeBaseEnabled: false,
            autoGenerateFactionInfo: false,
            autoSaveDepth: 1,
            worldBookSearchDepth: 5,
            attachBiographyToSnapshot: true,
            embeddingUrl: '',
            embeddingKey: '',
            embeddingModel: 'text-embedding-3-small',
            vectorProvider: 'api',
            vectorLocalModel: 'Xenova/bge-small-zh-v1.5',
            vectorAutoInject: false,
            vectorSearchMethod: 'local', // FRX: 默认本地提取检索条件，回合前不等模型
            vectorIndexPrompt: '',
            vectorSummaryPrompt: '',
            hybridKeywordPrompt: '', // 混合模式专用 Prompt
            vectorMaxResults: 3,
            vectorMinScore: 0.4,
            vectorContextLimit: 1,
            vectorCooldownRounds: 0,
            vectorSearchContextDepth: 1,
            hybridRecentLimit: 50, // 混合模式专用 Limit
            vectorAutoMerge: false,
            vectorOutdatedRetention: 50,
            vectorSendSegmentedMemory: false,
            vectorSearchApiUrl: '',
            vectorSearchApiKey: '',
            vectorSearchApiModel: '',
            vectorAutoSave: false,
            vectorSaveApiUrl: '',
            vectorSaveApiKey: '',
            vectorSaveApiModel: '',
            vectorSavePrompt: '',
            vectorAutoSaveFrequency: 1,
            enableRerank: false,
            rerankUrl: '',
            rerankKey: '',
            rerankModel: '',
            rerankTopK: 20,
            vectorChunkSize: 500,
            vectorBatchSize: 10,
            vectorFolders: [],
            factionRules: [],
            vectorAutoExtractMetadata: false,
            vectorDynamicFilter: false,
            vectorInjectMode: 'append', // 'append' = 自动追加到提示词末尾, 'macro' = 变量占位符模式

            // 【新增时间过滤默认值】
            vectorTimeFilter: false,
            vectorTimeFilterMode: 'year', // 默认只过滤年份
          };

          try {
            const savedConfig = await dbGet('CULTIVATION_KNOWLEDGE_SEARCH_API_CONFIG_V2');
            knowledgeSearchGlobalConfig = { ...defaultConfig, ...savedConfig };
            if (!Array.isArray(knowledgeSearchGlobalConfig.vectorFolders)) {
              knowledgeSearchGlobalConfig.vectorFolders = [];
            }
            knowledgeSearchGlobalConfig.attachBiographyToSnapshot = true;

            // 迁移旧数据
            if (savedConfig) {
              let needsMigration = false;
              // 如果旧配置存在 vectorMetadataApiUrl 但新配置 vectorSaveApiUrl 为空，则迁移
              if (savedConfig.vectorMetadataApiUrl && !knowledgeSearchGlobalConfig.vectorSaveApiUrl) {
                knowledgeSearchGlobalConfig.vectorSaveApiUrl = savedConfig.vectorMetadataApiUrl;
                needsMigration = true;
              }
              if (savedConfig.vectorMetadataApiKey && !knowledgeSearchGlobalConfig.vectorSaveApiKey) {
                knowledgeSearchGlobalConfig.vectorSaveApiKey = savedConfig.vectorMetadataApiKey;
                needsMigration = true;
              }
              if (savedConfig.vectorMetadataApiModel && !knowledgeSearchGlobalConfig.vectorSaveApiModel) {
                knowledgeSearchGlobalConfig.vectorSaveApiModel = savedConfig.vectorMetadataApiModel;
                needsMigration = true;
              }

              // 清理已废弃的配置键
              delete knowledgeSearchGlobalConfig.vectorMetadataApiUrl;
              delete knowledgeSearchGlobalConfig.vectorMetadataApiKey;
              delete knowledgeSearchGlobalConfig.vectorMetadataApiModel;
              delete knowledgeSearchGlobalConfig.vectorMetadataPrompt;
              delete knowledgeSearchGlobalConfig.vectorDynamicFilterPrompt;

              if (needsMigration) {
                console.log('[配置迁移] 已将 vectorMetadataApi 配置迁移到 vectorSaveApi');
                await dbSet('CULTIVATION_KNOWLEDGE_SEARCH_API_CONFIG_V2', knowledgeSearchGlobalConfig);
              }
            }
          } catch (e) {
            knowledgeSearchGlobalConfig = { ...defaultConfig };
          }
        }

// app.js 24994
        async function loadNpcDisplaySettings() {
          const defaultSettings = {
            showLinggen: true,
            showSpecialConstitution: true,
            showSexExperience: false,
            showSensitiveParts: false,
            showGenitalStatus: false,
            showEroticValue: false,
            showPleasureValue: false,
            showPublicKink: false,
            showPrivateKink: false,
            showSexualConception: false,
            showSkillsTab: true,
            showTraitsTab: true,
            customFields: [],
            npcImageWidth: 512,
            npcImageHeight: 768,
            showSpiritStones: true,
          };
          try {
            const savedSettings = await dbGet(NPC_DISPLAY_SETTINGS_KEY);
            npcDisplaySettings = { ...defaultSettings, ...savedSettings };
            if (npcDisplaySettings.showKinks !== undefined) {
              npcDisplaySettings.showPublicKink = npcDisplaySettings.showKinks;
              npcDisplaySettings.showPrivateKink = npcDisplaySettings.showKinks;
              delete npcDisplaySettings.showKinks;
            }
            if (!npcDisplaySettings.customFields) {
              npcDisplaySettings.customFields = [];
            }
          } catch (e) {
            npcDisplaySettings = defaultSettings;
          }
          if (!npcDisplaySettings.showAdultFields) {
            for (const key of ['showSexExperience','showSensitiveParts','showGenitalStatus','showEroticValue','showPleasureValue','showPublicKink','showPrivateKink','showSexualConception']) npcDisplaySettings[key] = false;
          }

        }

// app.js 27298
        async function loadPlayerDisplaySettings() {
          const defaultFields = [
            { key: 'linggen', label: '灵根', isEnabled: true },
            { key: 'hp', label: '血量', isEnabled: true },
            { key: 'gender', label: '性别', isEnabled: true },
            { key: 'age', label: '年龄', isEnabled: true },
            { key: 'shouyuan', label: '寿元', isEnabled: true },
            { key: 'realm', label: '境界', isEnabled: true },
            { key: 'shanE', label: '善恶值', isEnabled: true },
            { key: 'location', label: '所在地', isEnabled: true },
            { key: 'spiritStones', label: '当前灵石', isEnabled: true },
          ];
          const defaultSettings = {
            defaultFields: defaultFields,
            customFields: [],
          };
          try {
            const savedSettings = await dbGet(PLAYER_DISPLAY_SETTINGS_KEY);
            if (savedSettings && savedSettings.defaultFields) {
              playerDisplaySettings = savedSettings;
              defaultFields.forEach(df => {
                if (!playerDisplaySettings.defaultFields.some(sf => sf.key === df.key)) {
                  playerDisplaySettings.defaultFields.push(df);
                }
              });
            } else {
              playerDisplaySettings = defaultSettings;
            }
          } catch (e) {
            playerDisplaySettings = defaultSettings;
          }
        }

// app.js 35812
        async function loadSummaryConfig() {
          const defaultSmallSummaryPrompt = `<content>
{{content}}
</content>


请根据以上内容生成一段详细的小总结（约50-100字）。
忠实记录NPC与主角的言行举止，主角经历的事件，并记录重要NPC的相关信息，禁止使用编号，必须使用人名。

格式要求：时间/地点，剧情概括，重要NPC记录（如有）

请直接输出小总结内容，并且以<summary></summary>标签包裹，格式要求：
<summary>小总结内容</summary>。`;

          const defaultLargeSummaryPrompt = `请根据以下内容生成一段精简的大总结（约20-50字）。
用一句话概括主要事件和结果，禁止使用编号，必须使用人名。

<content>
{{content}}
</content>

请直接输出大总结内容，并且以<summary></summary>标签包裹，格式要求：
<summary>大总结内容</summary>。`;

          const defaultMemoryInputPrompt = `你是一个专业的小说档案管理员。用户选中了一段剧情文本，需要你将其融合到现有的记忆总结中。

## 现有小总结
{{existingSmallSummary}}

## 现有大总结
{{existingLargeSummary}}

## 用户选中的强调内容
{{selectedText}}

## 任务
请根据用户选中的内容，对现有的小总结和大总结进行强调补充。确保选中内容的关键信息被准确记录。

请按以下格式输出（保留XML标签）：

<small_summary>
（在此输出更新后的小总结，融入选中内容的关键信息，约50-100字）
</small_summary>

<large_summary>
（在此输出更新后的大总结，用一句话概括，约20-50字）
</large_summary>`;

          // 新增：自动比对的默认提示词
          const defaultVerificationPrompt = `你是一个严谨的记忆审计员。
你的任务是根据【审计标准】，对比【剧情正文】与【当前总结】，找出总结中遗漏的关键信息。

【审计标准】
{{criteria}}

【待审计数据】
{{input_data}}

请分析每一层数据。如果发现某层的【当前总结】遗漏了符合【审计标准】的重要信息（例如重要的约定、物品获取、人物关系变化），请生成补全内容。
如果没有遗漏，则忽略该层。

请严格返回 JSON 数组格式，格式如下：
[
  {
    "id": "日志ID",
    "missingSmall": "需要补充进小总结的内容（如无则留空）",
    "missingLarge": "需要补充进大总结的内容（如无则留空）"
  }
]

注意：只返回需要修改的层级。不要返回任何其他解释性文字。`;

          const defaultConfig = {
            apiUrl: '',
            apiKey: '',
            apiModel: 'gpt-3.5-turbo',

            deepSummaryPrompt: `你是一名专业的小说档案管理员。
请阅读 <input_data> 中的剧情记录，将其整理为精炼的记忆档案。
请按"约每10层"或"剧情小节"为单位进行分段记录。

请严格遵守以下输出格式（保留XML标签）：

<large_summary>
(在此处写一段50-100字的整体概括，作为本段记忆的简报标题)
</large_summary>

<small_summary>
<过往事件(本次合并的总层数范围)>

{剧情小节}: [时间/地点]
剧情概括: (约100字。忠实记录NPC与主角的言行举止，主角经历的事件，保留关键细节)
[重要NPC记录]
- NPC名字: 共同经历事件 | 态度转变 | 当前关系 | 当前进行的事件
- NPC名字: ...

(根据输入内容的长度，请重复上述结构及其详细信息，确保不遗漏)
</small_summary>`,

            smallSummaryPrompt: defaultSmallSummaryPrompt,
            largeSummaryPrompt: defaultLargeSummaryPrompt,

            apiSource: 'custom',
            segmentedMemoryEnabled: false,
            segmentedChatLayers: 20,
            segmentedLargeSummaryStart: 50,
            segmentedSummaryThreshold: 10,
            autoDeepSummaryEnabled: false,
            
            // 新增：单独 API 更新相关配置
            autoApiUpdateEnabled: false,
            autoUpdateSmallSummary: true,
            autoUpdateLargeSummary: false,
            
            // 新增：录入记忆提示词
            memoryInputPrompt: defaultMemoryInputPrompt,

            // === 新增配置项 ===
            autoVerificationEnabled: false, // 功能开关
            verificationInterval: 5,        // 比对层数阈值
            verificationCriteria: "重要约定、关键物品获取、人物好感度剧烈变化、伏笔", // 比对内容
            verificationPrompt: defaultVerificationPrompt, // 提示词
          };

          try {
            summaryConfig = (await dbGet(SUMMARY_CONFIG_KEY)) || defaultConfig;
            // 确保新字段有默认值
            if (!summaryConfig.smallSummaryPrompt) summaryConfig.smallSummaryPrompt = defaultSmallSummaryPrompt;
            if (!summaryConfig.largeSummaryPrompt) summaryConfig.largeSummaryPrompt = defaultLargeSummaryPrompt;
            if (summaryConfig.autoApiUpdateEnabled === undefined) summaryConfig.autoApiUpdateEnabled = false;
            if (summaryConfig.autoUpdateSmallSummary === undefined) summaryConfig.autoUpdateSmallSummary = true;
            if (summaryConfig.autoUpdateLargeSummary === undefined) summaryConfig.autoUpdateLargeSummary = false;
            if (!summaryConfig.memoryInputPrompt) summaryConfig.memoryInputPrompt = defaultMemoryInputPrompt;
            
            if (summaryConfig.autoVerificationEnabled === undefined) summaryConfig.autoVerificationEnabled = false;
            if (!summaryConfig.verificationInterval) summaryConfig.verificationInterval = 5;
            if (!summaryConfig.verificationCriteria) summaryConfig.verificationCriteria = "重要约定、关键物品获取、人物好感度剧烈变化、伏笔";
            if (!summaryConfig.verificationPrompt) summaryConfig.verificationPrompt = defaultVerificationPrompt;
          } catch (e) {
            summaryConfig = defaultConfig;
          }
        }

// app.js 36617
        async function loadRegexConfig() {
          const defaultConfig = {
            fontSize: 1.05,
            fontColor: '#f5f5dc',
            chatFont: "'Noto Sans SC', 'Source Han Sans SC', sans-serif",
            renderLimit: 100,
            contextLimit: 0,
            autoHideSummarized: false,
            fogOfWarMode: false,
            fixedHideRange: '',
            enableStreaming: false,
            miniMapSize: 200,
            miniMapVisible: false,
            miniMapPosition: null,
            miniMapOpacity: 1.0,
            rules: [],
            chainRules: [],
            fogConfig: {
              triggers:
                '我攻击,攻击,防御,闪避,躲开,逃跑,快逃,施展,使用,催动,祭出,运转,吸收,炼化,吞噬,搜寻,探索,调查,检查,观察,偷袭,潜入,闯入,跟踪,尾随,我决定,决定,我准备,准备,我尝试,尝试,试图,打算,走,去,前往,进入,我要,我想,询问,质问,套话,威胁,恐吓,利诱,说服,交易,购买,购买,出售,卖掉,突破,冲击,结丹,凝婴,渡劫,修炼,打坐,炼制,炼丹,炼器,画符,制作,破解,沟通,交谈,求饶,搭讪,挑衅,激怒,安抚,治疗,搜身,夺取,抢夺,偷窃,救,帮助,查看,探查,神识探查,鉴定,辨别,追踪',
              realmSuppressionBase: 5,
              luckMultiplier: 0.05,
              charmMultiplier: 0.05,
              multipliers: {
                hp: 0.1,
                mp: 0.1,
                atkPhy: 1.5,
                atkMag: 1.5,
                defPhy: 1.0,
                defMag: 1.0,
                shenshi: 2.0,
                speed: 1.0,
              },
              combat: {
                bigOminous:
                  '【天机演算：大凶 (战斗判定)】遭遇绝对压制！${targetDesc}的实力远超预期。${contextDesc}，且我方支援（如有）也被牵制。玩家身陷绝境，招式被破，身受重伤或面临生死危机。',
                ominous:
                  '【天机演算：凶 (战斗判定)】战斗陷入劣势！${targetDesc}攻势凶猛。${contextDesc}，玩家处处受制，进攻乏力，只能被动防守，稍有不慎便会落败。',
                auspicious:
                  '【天机演算：吉 (战斗判定)】占据上风！玩家看破了${targetDesc}的破绽。虽然敌人强大，但凭借我方（含灵兽/盟友）的配合或属性优势，压制了对手，取得了战斗主动权。',
                bigAuspicious:
                  '【天机演算：大吉 (战斗判定)】碾压之势！玩家与盟友/灵兽实力完全爆发，配合默契，以雷霆万钧之势击溃了${targetDesc}，可能将其重创或斩杀，获得辉煌胜利。',
              },
              nonCombat: {
                bigOminous:
                  '【天机演算：大凶】在接下来的剧情中，你必须制造一个极其负面、倒霉甚至可能导致角色重伤或陷入绝境的事件。',
                ominous:
                  '【天机演算：凶】在接下来的剧情中，你必须引入一个负面事件或障碍，让角色的行动受阻或付出额外代价。',
                auspicious:
                  '【天机演算：吉】在接下来的剧情中，你必须引入一个正面事件或机遇，让角色的行动顺利或获得意外的好处。',
                bigAuspicious:
                  '【天机演算：大吉】在接下来的剧情中，你必须创造一个极其正面、幸运的重大机遇，可能让角色获得稀有宝物、功法或修为大增。',
              },
            },
          };

          try {
            regexConfig = (await dbGet(REGEX_CONFIG_KEY)) || defaultConfig;
            // ... (配置合并逻辑保持不变) ...
            if (!regexConfig.fogConfig) regexConfig.fogConfig = defaultConfig.fogConfig;
            if (!regexConfig.fogConfig.combat) regexConfig.fogConfig.combat = defaultConfig.fogConfig.combat;
            if (!regexConfig.fogConfig.nonCombat) regexConfig.fogConfig.nonCombat = defaultConfig.fogConfig.nonCombat;
            if (!regexConfig.fogConfig.multipliers)
              regexConfig.fogConfig.multipliers = defaultConfig.fogConfig.multipliers;
            if (regexConfig.fogConfig.realmSuppressionBase === undefined)
              regexConfig.fogConfig.realmSuppressionBase = 5;
            if (regexConfig.fogConfig.luckMultiplier === undefined) regexConfig.fogConfig.luckMultiplier = 0.1;
            if (regexConfig.fogConfig.charmMultiplier === undefined) regexConfig.fogConfig.charmMultiplier = 0.1;
          } catch (e) {
            regexConfig = defaultConfig;
          }
        }

// app.js 46906
        async function manageThinkingApiSettings() {
          const THINKING_API_CONFIG_KEY = 'CULTIVATION_THINKING_API_CONFIG_V1';
          const THINKING_PRESETS_KEY = 'CULTIVATION_THINKING_PRESETS_V2';

          const DEFAULT_THINKING_PROMPT_TEMPLATE = `### 状态快照
\${state_snapshot}
### 剧情原文
\${story_text}`;

          const loadConfig = async () => {
            const savedConfig = (await dbGet(THINKING_API_CONFIG_KEY)) || {};
            thinkingApiConfig = {
              enabled: savedConfig.enabled || false,
              apiUrl: savedConfig.apiUrl || '',
              apiKey: savedConfig.apiKey || '',
              apiModel: savedConfig.apiModel || '',
              useGeminiBuild: false,
              enableStreaming: savedConfig.enableStreaming || false,
              maxRetries: savedConfig.maxRetries !== undefined ? savedConfig.maxRetries : 3,
            };

            let presetsData = await dbGet(THINKING_PRESETS_KEY);

            if (!presetsData || !presetsData.presets) {
              const defaultPreset = {
                id: 'default',
                name: '默认配置',
                promptTemplate: DEFAULT_THINKING_PROMPT_TEMPLATE,
                worldBooks: [DEFAULT_VARIABLE_THINKING_WORLDBOOK],
              };
              presetsData = {
                activePresetId: 'default',
                presets: [defaultPreset],
              };
              await dbSet(THINKING_PRESETS_KEY, presetsData);
            }
          };

          await loadConfig();
        }

// app.js 49872
        async function loadDefaultMapSetting() {
          currentDefaultMapArchiveName = await dbGet(DEFAULT_MAP_KEY);
          if (currentDefaultMapArchiveName && currentDefaultMapArchiveName !== 'default-initial-map') {
            const archive = await db.archives.get(currentDefaultMapArchiveName);
            if (archive) {
              WORLD_MAP_DATA = archive.data.state?.worldMap || DEFAULT_WORLD_MAP_DATA;
            } else {
              // 如果存档不存在，回退到默认初始地图
              WORLD_MAP_DATA = DEFAULT_WORLD_MAP_DATA;
              currentDefaultMapArchiveName = 'default-initial-map';
              await dbSet(DEFAULT_MAP_KEY, 'default-initial-map');
            }
          } else {
            WORLD_MAP_DATA = DEFAULT_WORLD_MAP_DATA;
            currentDefaultMapArchiveName = 'default-initial-map';
            await dbSet(DEFAULT_MAP_KEY, 'default-initial-map');
          }
          
          // 加载地图发送策略设置
          await loadMapSendStrategySetting();
        }

// app.js 49894
        async function loadMapSendStrategySetting() {
          const savedStrategy = await dbGet(MAP_SEND_STRATEGY_KEY);
          if (savedStrategy && ['minimal', 'moderate', 'full'].includes(savedStrategy)) {
            currentMapSendStrategy = savedStrategy;
          } else {
            currentMapSendStrategy = 'moderate'; // 默认较省模式
          }
        }

module.exports = {
  DEFAULT_VARIABLE_THINKING_WORLDBOOK,
  NPC_DISPLAY_SETTINGS_KEY,
  PLAYER_DISPLAY_SETTINGS_KEY,
  DAILY_PAPER_PRESETS_KEY,
  WORLD_EVOLUTION_API_CONFIG_KEY,
  WORLD_EVOLUTION_PRESETS_KEY,
  THEATER_WORLDBOOKS_KEY,
  PERMANENT_PROMPTS_KEY,
  ACTIVE_ARCHIVE_KEY,
  SUMMARY_CONFIG_KEY,
  REGEX_CONFIG_KEY,
  CUSTOM_TRAITS_KEY,
  CUSTOM_BIRTHS_KEY,
  CUSTOM_RACES_KEY,
  CUSTOM_WORLD_FACTORS_KEY,
  CUSTOM_AVATAR_KEY,
  dbGet,
  dbSet,
  DEFAULT_MAP_KEY,
  MAP_SEND_STRATEGY_KEY,
  manageKnowledgeSearchApiSettings,
  loadNpcDisplaySettings,
  loadPlayerDisplaySettings,
  loadSummaryConfig,
  loadRegexConfig,
  manageThinkingApiSettings,
  loadDefaultMapSetting,
  loadMapSendStrategySetting,
};
