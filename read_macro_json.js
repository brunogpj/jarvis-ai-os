const fs = require('fs');

const files = [
  'Jarvis_Conversa_Premium.macro',
  'Jarvis_Notificações_Premium.macro',
  'Jarvis_Notificação_Interativa.macro'
];

files.forEach(file => {
  console.log(`\n=================== FILE: ${file} ===================`);
  try {
    const raw = fs.readFileSync('C:\\Users\\Visitante\\Documents\\Macros\\' + file, 'utf8');
    const data = JSON.parse(raw);
    console.log("Name:", data.macro.m_name);
    console.log("Description:", data.macro.m_description);
    
    // Print triggers
    console.log("Triggers:");
    data.macro.m_triggerList.forEach(t => {
      console.log(` - Class: ${t.m_classType}, Identifier/Name: ${t.identifier || t.m_name || t.m_label}`);
    });
    
    // Search actions
    console.log("Actions matching keyword:");
    data.macro.m_actionList.forEach(a => {
      const str = JSON.stringify(a);
      if (str.toLowerCase().includes('maps') || str.toLowerCase().includes('google') || str.toLowerCase().includes('intent') || str.toLowerCase().includes('abrir') || str.toLowerCase().includes('site')) {
        console.log(` - Class: ${a.m_classType}, Details:`, str.substring(0, 400));
      }
    });
  } catch (e) {
    console.log("Error:", e.message);
  }
});
