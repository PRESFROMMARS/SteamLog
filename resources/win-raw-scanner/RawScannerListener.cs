// Framework 4.x / C# 5. No WinForms, NuGet, hooks, registry or startup entries.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

internal static class RawScannerListener
{
    const uint WM_INPUT = 0x00FF, WM_TIMER = 0x0113, WM_DEVICE_CHANGE = 0x00FE;
    const uint RID_INPUT = 0x10000003, RIDI_DEVICENAME = 0x20000007;
    const uint RIDEV_INPUTSINK = 0x00000100, RIDEV_DEVNOTIFY = 0x00002000;
    static readonly Dictionary<IntPtr, DeviceBuffer> Buffers = new Dictionary<IntPtr, DeviceBuffer>();
    static readonly WndProc Callback = WindowProc; // Root the delegate for the entire message loop.
    static readonly IntPtr HWND_MESSAGE = new IntPtr(-3);
    static Process Parent;
    static long LastPulse;
    static readonly int HeaderSize = Marshal.SizeOf(typeof(RAWINPUTHEADER));
    static long Millis { get { return (long)(Stopwatch.GetTimestamp() * (1000.0 / Stopwatch.Frequency)); } }
    sealed class DeviceBuffer
    {
        internal readonly StringBuilder Text = new StringBuilder();
        internal string Name;
        internal long First, Last;
        internal bool Slow, LeftShift, RightShift, Control, Alt;
        internal readonly HashSet<int> Down = new HashSet<int>();
        internal DeviceBuffer(string name) { Name = name; }
        internal void Clear() { Text.Length = 0; First = Last = 0; Slow = false; }
    }
    [StructLayout(LayoutKind.Sequential)] struct RAWINPUTDEVICE { public ushort Page, Usage; public uint Flags; public IntPtr Target; }
    [StructLayout(LayoutKind.Sequential)] struct RAWINPUTHEADER { public uint Type, Size; public IntPtr Device, WParam; }
    [StructLayout(LayoutKind.Sequential)] struct RAWKEYBOARD { public ushort MakeCode, Flags, Reserved, VKey; public uint Message, Extra; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct WNDCLASS
    { public uint Style; public WndProc Proc; public int ClassExtra, WindowExtra; public IntPtr Instance, Icon, Cursor, Background; public string Menu, ClassName; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr Window; public uint Message; public UIntPtr WParam; public IntPtr LParam; public uint Time; public POINT Point; public uint Private; }
    delegate IntPtr WndProc(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern ushort RegisterClass(ref WNDCLASS wc);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateWindowEx(uint ex, string cls, string title, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll", SetLastError = true)] static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] devices, uint count, uint size);
    [DllImport("user32.dll", SetLastError = true)] static extern uint GetRawInputData(IntPtr input, uint command, IntPtr data, ref uint size, uint headerSize);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern uint GetRawInputDeviceInfo(IntPtr device, uint command, StringBuilder data, ref uint size);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr DefWindowProc(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetMessage(out MSG msg, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr DispatchMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern UIntPtr SetTimer(IntPtr window, UIntPtr id, uint interval, IntPtr callback);
    [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr window);

    static string Quote(string value)
    {
        StringBuilder s = new StringBuilder("\"");
        foreach (char c in value) { if (c == '"' || c == '\\') s.Append('\\').Append(c); else if (c < 32) s.Append("\\u").Append(((int)c).ToString("x4")); else s.Append(c); }
        return s.Append('"').ToString();
    }
    static void Emit(string json) { Console.Out.WriteLine(json); Console.Out.Flush(); }
    static string DeviceName(IntPtr device)
    {
        uint count = 0;
        if (GetRawInputDeviceInfo(device, RIDI_DEVICENAME, null, ref count) == uint.MaxValue || count == 0 || count > 32768) return "";
        StringBuilder name = new StringBuilder((int)count + 1);
        return GetRawInputDeviceInfo(device, RIDI_DEVICENAME, name, ref count) == uint.MaxValue ? "" : name.ToString();
    }
    // Scanner configuration: USB HID US-English keyboard; case is normalized in Main.
    // Decode shift locally, never consult merged OS keyboard state from the other gun.
    static char Decode(int key, bool shift)
    {
        if (key >= 0x41 && key <= 0x5A) return (char)key;
        if (key >= 0x30 && key <= 0x39) return shift ? ")!@#$%^&*("[key - 0x30] : (char)key;
        if (key >= 0x60 && key <= 0x69) return (char)('0' + key - 0x60);
        if (key == 0xBD) return shift ? '_' : '-';
        if (key == 0x6D) return '-';
        return '\0';
    }
    static void ReadInput(IntPtr input)
    {
        uint size = 0;
        if (GetRawInputData(input, RID_INPUT, IntPtr.Zero, ref size, (uint)HeaderSize) == uint.MaxValue || size < HeaderSize + 16 || size > 65536) return;
        IntPtr memory = Marshal.AllocHGlobal((int)size);
        try
        {
            if (GetRawInputData(input, RID_INPUT, memory, ref size, (uint)HeaderSize) != size) return;
            RAWINPUTHEADER header = (RAWINPUTHEADER)Marshal.PtrToStructure(memory, typeof(RAWINPUTHEADER));
            if (header.Type != 1 || header.Device == IntPtr.Zero) return;
            RAWKEYBOARD key = (RAWKEYBOARD)Marshal.PtrToStructure(IntPtr.Add(memory, HeaderSize), typeof(RAWKEYBOARD));
            DeviceBuffer buffer;
            if (!Buffers.TryGetValue(header.Device, out buffer)) { buffer = new DeviceBuffer(DeviceName(header.Device)); Buffers.Add(header.Device, buffer); }
            int v = key.VKey; bool released = (key.Flags & 1) != 0;
            if (v == 0x10 || v == 0xA0 || v == 0xA1) { if (v == 0xA1 || (v == 0x10 && key.MakeCode == 0x36)) buffer.RightShift = !released; else buffer.LeftShift = !released; return; }
            if (v == 0x11 || v == 0xA2 || v == 0xA3) { buffer.Control = !released; buffer.Clear(); return; }
            if (v == 0x12 || v == 0xA4 || v == 0xA5) { buffer.Alt = !released; buffer.Clear(); return; }
            if (released) { buffer.Down.Remove(v); return; }
            if (v == 255 || key.MakeCode == 255 || buffer.Control || buffer.Alt) { buffer.Clear(); return; }
            // Keyboard auto-repeat must not become a synthetic scanner burst.
            if (!buffer.Down.Add(v)) { buffer.Slow = true; return; }
            long now = Millis;
            if (buffer.Last != 0 && now - buffer.Last > 300) buffer.Clear();
            if (buffer.Last != 0 && now - buffer.Last > 35) buffer.Slow = true;
            if (v == 0x0D || v == 0x09)
            {
                if (!buffer.Slow && buffer.Text.Length >= 2 && buffer.Name.Length > 0)
                {
                    long stamp = (DateTime.UtcNow.Ticks - 621355968000000000L) / 10000;
                    Emit("{\"type\":\"scan\",\"hDevice\":" + Quote("0x" + header.Device.ToInt64().ToString("X", CultureInfo.InvariantCulture)) + ",\"deviceName\":" + Quote(buffer.Name) + ",\"barcode\":" + Quote(buffer.Text.ToString()) + ",\"burstMs\":" + (now - buffer.First).ToString(CultureInfo.InvariantCulture) + ",\"ts\":" + stamp.ToString(CultureInfo.InvariantCulture) + "}");
                }
                buffer.Clear(); return;
            }
            char character = Decode(v, buffer.LeftShift || buffer.RightShift);
            if (character == '\0') { buffer.Clear(); buffer.Slow = true; buffer.Last = now; return; }
            if (buffer.Text.Length >= 128) { buffer.Slow = true; buffer.Last = now; return; }
            if (buffer.Text.Length == 0) buffer.First = now;
            buffer.Text.Append(character); buffer.Last = now;
        }
        finally { Marshal.FreeHGlobal(memory); }
    }
    static IntPtr WindowProc(IntPtr window, uint message, IntPtr wParam, IntPtr lParam)
    {
        try
        {
            if (message == WM_INPUT) ReadInput(lParam);
            if (message == WM_TIMER)
            {
                if (Parent != null && Parent.HasExited) Environment.Exit(0);
                long now = Millis;
                foreach (DeviceBuffer b in Buffers.Values) if (b.Last != 0 && now - b.Last > 300) b.Clear();
                if (now - LastPulse >= 5000) { Emit("{\"type\":\"heartbeat\"}"); LastPulse = now; }
            }
            if (message == WM_DEVICE_CHANGE && wParam.ToInt32() == 2)
            {
                DeviceBuffer b;
                if (Buffers.TryGetValue(lParam, out b)) { Emit("{\"type\":\"removed\",\"hDevice\":" + Quote("0x" + lParam.ToInt64().ToString("X")) + ",\"deviceName\":" + Quote(b.Name) + "}"); Buffers.Remove(lParam); }
            }
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); Console.Error.Flush(); }
        // Required for foreground WM_INPUT cleanup, even when input was handled.
        return DefWindowProc(window, message, wParam, lParam);
    }
    static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        IntPtr window = IntPtr.Zero;
        try
        {
            if (args.Length == 1) { Parent = Process.GetProcessById(int.Parse(args[0], CultureInfo.InvariantCulture)); IntPtr parentHandle = Parent.Handle; }
            IntPtr instance = GetModuleHandle(null);
            WNDCLASS cls = new WNDCLASS(); cls.Proc = Callback; cls.Instance = instance; cls.ClassName = "SteamLogRawScanner";
            if (RegisterClass(ref cls) == 0) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            window = CreateWindowEx(0, cls.ClassName, "", 0, 0, 0, 0, 0, HWND_MESSAGE, IntPtr.Zero, instance, IntPtr.Zero);
            if (window == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            RAWINPUTDEVICE device = new RAWINPUTDEVICE(); device.Page = 1; device.Usage = 6; device.Flags = RIDEV_INPUTSINK | RIDEV_DEVNOTIFY; device.Target = window;
            if (!RegisterRawInputDevices(new RAWINPUTDEVICE[] { device }, 1, (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICE)))) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            if (SetTimer(window, new UIntPtr(1), 100, IntPtr.Zero) == UIntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            Emit("{\"type\":\"ready\",\"platform\":\"win32-raw-input\"}");
            MSG msg; int result;
            while ((result = GetMessage(out msg, IntPtr.Zero, 0, 0)) > 0) { TranslateMessage(ref msg); DispatchMessage(ref msg); }
            if (result < 0) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error.ToString()); return 1; }
        finally { if (window != IntPtr.Zero) DestroyWindow(window); }
    }
}
