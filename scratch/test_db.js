const { createClient } = require('@supabase/supabase-js');

const url = 'https://jsdvhryfmuadxaijmsjb.supabase.co';
const key = 'sb_publishable_ufJ4lt-JiL9ONh5X9X6ZHw_PE58RM1F';
const supabase = createClient(url, key);

async function test() {
  console.log("正在测试连接 Supabase...");
  
  // 1. 测试查询 airports 表
  try {
    const { data, error } = await supabase.from('airports').select('id, name').limit(1);
    if (error) {
      console.error("❌ 查询 airports 表失败，报错信息：", error.message, error.details || '');
    } else {
      console.log("✅ airports 表查询成功！数据示例：", data);
    }
  } catch (err) {
    console.error("❌ airports 表请求异常：", err);
  }

  // 2. 测试查询 speed_logs 表
  try {
    const { data, error } = await supabase.from('speed_logs').select('id').limit(1);
    if (error) {
      console.error("❌ 查询 speed_logs 表失败，报错信息：", error.message, error.details || '');
    } else {
      console.log("✅ speed_logs 表查询成功！");
    }
  } catch (err) {
    console.error("❌ speed_logs 表请求异常：", err);
  }
}

test();
