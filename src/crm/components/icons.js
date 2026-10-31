import {
  Building2, Hexagon, Landmark, ClipboardList, Layers, BriefcaseBusiness,
  Phone, PhoneCall, Monitor, Mail, FileText, File, Users, Tag, Eye, Utensils,
  Settings, Handshake, Rocket, MessageCircle, Trophy, Map, Link, MessagesSquare,
} from 'lucide-react'

export const companyIcons = {
  building: Building2,
  hexagon: Hexagon,
  landmark: Landmark,
  clipboard: ClipboardList,
  layers: Layers,
  briefcase: BriefcaseBusiness,
}

export const eventIcons = {
  phone: Phone,
  phoneCall: PhoneCall,
  monitor: Monitor,
  mail: Mail,
  file: FileText,
  fileText: FileText,
  fileBlank: File,
  users: Users,
  tag: Tag,
  eye: Eye,
  utensils: Utensils,
  settings: Settings,
  handshake: Handshake,
  rocket: Rocket,
  message: MessageCircle,
  trophy: Trophy,
  map: Map,
  link: Link,
  messages: MessagesSquare,
}

// Options shown in the event editor's "Type" picker
export const eventTypeOptions = [
  { value: 'phone', label: 'Call' },
  { value: 'phoneCall', label: 'Team call' },
  { value: 'monitor', label: 'Demo' },
  { value: 'mail', label: 'Email' },
  { value: 'file', label: 'Document' },
  { value: 'fileBlank', label: 'Contract' },
  { value: 'users', label: 'Meeting' },
  { value: 'message', label: 'Q&A' },
  { value: 'messages', label: 'Feedback' },
  { value: 'tag', label: 'Pricing' },
  { value: 'handshake', label: 'Negotiation' },
  { value: 'settings', label: 'Review / setup' },
  { value: 'utensils', label: 'Lunch' },
  { value: 'map', label: 'Site visit' },
  { value: 'eye', label: 'Website visit' },
  { value: 'link', label: 'Outreach' },
  { value: 'rocket', label: 'Onboarding' },
  { value: 'trophy', label: 'Closing' },
]
