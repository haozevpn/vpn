import os
import sys
import traceback

def test_connection():
    print("=" * 60)
    print("  Supabase Python SDK 连通性测试诊断开始")
    print("=" * 60)
    
    # 1. 检查环境变量
    url = os.environ.get("SUPABASE_URL", "").strip()
    if url.endswith("/rest/v1/"):
        url = url[:-9]
    elif url.endswith("/rest/v1"):
        url = url[:-8]
        
    anon = os.environ.get("SUPABASE_ANON_KEY", "").strip()
    service = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    
    print(f"SUPABASE_URL (已清洗): {url}")
    print(f"SUPABASE_ANON_KEY 长度: {len(anon) if anon else 0}")
    print(f"SUPABASE_SERVICE_KEY 长度: {len(service) if service else 0}")
    
    if not url or not service:
        print("❌ 错误：缺少 SUPABASE_URL 或 SUPABASE_SERVICE_KEY 环境变量！")
        sys.exit(1)
        
    # 2. 尝试导入 supabase
    try:
        from supabase import create_client, Client
        print("✅ 成功导入 supabase-py 库")
    except Exception as e:
        print("❌ 导入 supabase 失败：")
        traceback.print_exc()
        sys.exit(1)
        
    # 3. 尝试初始化 Client
    try:
        client: Client = create_client(url, service)
        print("✅ 成功初始化 Supabase 客户端")
    except Exception as e:
        print("❌ 初始化 Supabase 客户端报错：")
        traceback.print_exc()
        sys.exit(1)
        
    # 4. 尝试执行简单查询
    try:
        res = client.table("airports").select("id, name").limit(1).execute()
        print("✅ 成功读取 airports 表！返回数据：", res.data)
    except Exception as e:
        print("❌ 读取 airports 表报错：")
        traceback.print_exc()
        sys.exit(1)
        
    print("=" * 60)
    print("  所有测试均已成功通过！")
    print("=" * 60)

if __name__ == "__main__":
    test_connection()
