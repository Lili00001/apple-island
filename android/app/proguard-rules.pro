# 默认不启用混淆（release 中 minifyEnabled=false），此处保留占位规则。
-keepattributes *Annotation*
-keepclassmembers class * { @android.webkit.JavascriptInterface <methods>; }
